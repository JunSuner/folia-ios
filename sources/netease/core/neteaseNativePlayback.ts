import type {
    FoliumSourceAudioQuality,
    FoliumSourceExternalPlayback,
    FoliumSourceExternalStatus,
    FoliumSourceSong,
} from '@folia/folium';

// sources/netease/core/neteaseNativePlayback.ts
// iOS 版：网易云的歌交给 App 自带的原生播放器（AVQueuePlayer，ios/App/App/NativePlayerPlugin.swift），切到后台、
// 锁屏照样放，锁屏和控制中心有「正在播放」。宿主经 playback.external@1 驱动它、跟着它的时钟走；页面里有
// window.FoliaNativePlayer（ios/native-player/bridge.js）时才有这条路（neteaseProvider.ts 的 routeOf），桌面和网页版
// 没有它，照旧走 playback.audio@1。播放地址在这里取（和 playback.audio@1 同一个请求），连同锁屏上显示的信息交给播放器。
// 播放器会自己接上准备好的下一首（App 在后台时页面可能被系统冻住）：宿主再来问上一首时答「放完了」，宿主照常换到下一首，
// 起播时先问播放器能不能认领（adopt），正在放的那首不重新开始。

/** 交给播放器的一首歌。 */
interface NativeTrack {
    mediaId: string;
    url: string;
    title: string;
    artist: string;
    album: string;
    artworkUrl?: string;
    durationMs?: number;
}

/** 播放器自己报的状态（NativePlayerPlugin.status）。 */
interface NativeStatus {
    mediaId: string;
    isPlaying: boolean;
    starting: boolean;
    seeking: boolean;
    ended: boolean;
    positionMs: number;
    durationMs: number;
    /** 上次起播之后放完或被锁屏跳过的歌。 */
    finished?: string[];
    /** 现在这首放不下去的原因。 */
    error?: string;
}

/** window.FoliaNativePlayer 的形状（ios/native-player/bridge.js）。 */
interface NativePlayerBridge {
    play(options: { track: NativeTrack; startSec: number; upcoming?: NativeTrack[] }): Promise<unknown>;
    adopt(options: { mediaId: string }): Promise<{ adopted?: boolean } | undefined>;
    prepare(options: { after: string; upcoming: NativeTrack[] }): Promise<unknown>;
    pause(): Promise<unknown>;
    resume(): Promise<unknown>;
    seek(options: { seconds: number }): Promise<unknown>;
    setVolume(options: { volume: number }): Promise<unknown>;
    setRepeatOne(options: { enabled: boolean }): Promise<unknown>;
    status(): Promise<NativeStatus>;
    audioQuality(): string | null;
}

const nativePlayer = (): NativePlayerBridge | null => (
    (globalThis as { FoliaNativePlayer?: NativePlayerBridge }).FoliaNativePlayer ?? null
);

/** Whether this page has the app's native player (the iOS build). */
export const hasNeteaseNativePlayer = (): boolean => nativePlayer() !== null;

/** 一个播放地址用多久：网易云给的地址过一阵会失效，排着的歌也可能很久以后才放到。 */
const URL_FRESH_MS = 10 * 60 * 1000;
/** 记几首歌的地址。 */
const URL_CACHE_LIMIT = 16;
/** 锁屏封面要的尺寸（网易云图床的 param）。 */
const ARTWORK_PARAM = '600y600';

const QUALITIES: readonly FoliumSourceAudioQuality[] = ['standard', 'high', 'ultra', 'lossless', 'hires'];

/** 宿主存的音质；旧版存的 exhigh 是现在的 high，认不出的按 high。 */
const qualityOf = (stored: string | null): FoliumSourceAudioQuality => {
    if (stored === 'exhigh') return 'high';
    return QUALITIES.find(quality => quality === stored) ?? 'high';
};

const artworkOf = (song: FoliumSourceSong): string | undefined => {
    const url = song.coverUrl || song.album?.coverUrl;
    if (!url) return undefined;
    const secure = url.replace(/^http:/, 'https:');
    return secure.includes('?') ? secure : `${secure}?param=${ARTWORK_PARAM}`;
};

/** iOS 原生播放器上的 playback.external@1。getUrl 取一首歌在某个音质的播放地址。 */
export const createNeteaseNativePlayback = (
    getUrl: (song: FoliumSourceSong, quality: FoliumSourceAudioQuality) => Promise<string>,
): FoliumSourceExternalPlayback => {
    const player = (): NativePlayerBridge => {
        const found = nativePlayer();
        if (!found) throw new Error('The native player is not in this page');
        return found;
    };
    const urls = new Map<string, { url: string; quality: FoliumSourceAudioQuality; at: number }>();
    /** 最近一次交给播放器排在后面的歌。 */
    let prepared: string[] = [];

    const urlOf = async (song: FoliumSourceSong): Promise<string> => {
        const quality = qualityOf(player().audioQuality());
        const kept = urls.get(song.id);
        if (kept && kept.quality === quality && Date.now() - kept.at < URL_FRESH_MS) return kept.url;
        const url = await getUrl(song, quality);
        urls.delete(song.id);
        urls.set(song.id, { url, quality, at: Date.now() });
        while (urls.size > URL_CACHE_LIMIT) urls.delete(urls.keys().next().value as string);
        return url;
    };

    const trackOf = async (song: FoliumSourceSong): Promise<NativeTrack> => ({
        mediaId: song.id,
        url: await urlOf(song),
        title: song.title,
        artist: song.artists.map(artist => artist.name).filter(Boolean).join(' / '),
        album: song.album?.name ?? '',
        artworkUrl: artworkOf(song),
        ...(song.durationMs ? { durationMs: song.durationMs } : {}),
    });

    return {
        async prepareNext(song, upcoming) {
            const tracks: NativeTrack[] = [];
            for (const next of upcoming) {
                try {
                    tracks.push(await trackOf(next));
                } catch (error) {
                    // 取不到地址的歌不排，它后面的也不排：队列放到那里停下，宿主按自己的队列处理这首。
                    console.warn('[NeteaseNative] the address of a coming song could not be read', error);
                    break;
                }
            }
            await player().prepare({ after: song.id, upcoming: tracks });
            prepared = tracks.map(track => track.mediaId);
        },
        isPrepared: song => prepared.includes(song.id),
        async play(song, startSec) {
            // 播放器已经自己接上了这首（或者页面冻住时已经放过它）：认领，不重新开始，也不用再取地址。
            if (startSec < 1) {
                const answer = await player().adopt({ mediaId: song.id });
                if (answer?.adopted) {
                    console.info('[NeteaseNative] took over the song the player moved on to');
                    return;
                }
            }
            const track = await trackOf(song);
            prepared = [];
            await player().play({ track, startSec, upcoming: [] });
        },
        async pause() {
            await player().pause();
        },
        async resume() {
            await player().resume();
        },
        async seek(seconds) {
            await player().seek({ seconds });
        },
        async setVolume(volume) {
            await player().setVolume({ volume });
        },
        async setRepeatOne(enabled) {
            await player().setRepeatOne({ enabled });
        },
        async getStatus(song): Promise<FoliumSourceExternalStatus> {
            const status = await player().status();
            if (status.mediaId === song.id && status.error) {
                throw new Error(`The native player could not play the song: ${status.error}`);
            }
            if (status.mediaId !== song.id && status.finished?.includes(song.id)) {
                // 播放器已经放完这首、接着放下一首了：对宿主就是这首放完了，宿主随后换到下一首、认领它。
                const durationMs = song.durationMs ?? 0;
                return { mediaId: song.id, isPlaying: false, positionMs: durationMs, durationMs, ended: true };
            }
            return {
                mediaId: status.mediaId,
                isPlaying: status.isPlaying,
                positionMs: status.positionMs,
                durationMs: status.durationMs,
                ended: status.ended,
                ...(status.starting ? { starting: true } : {}),
                ...(status.seeking ? { seeking: true } : {}),
            };
        },
        isStatusForSong: (song, status) => status.mediaId === song.id,
    };
};
