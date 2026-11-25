// ios/netease-local/server.ts
// 手机上的"网易云 API 服务"：代替 Mac 上的 Node 服务，回答 Folia 发给 API 地址的请求（bootstrap.js 把这些 fetch 转到这里）。
// 做的事和上游 server.js + Folia 桌面端的工作线程（sources/netease/main/）一样：
// - 按路径找到包里 module/ 下对应的文件，把查询参数（含 cookie）交给它，用上游的 util/request 发请求；
// - 启动时准备 cnIp、deviceId、xeapi 公钥和匿名 token（桌面端 neteaseApiWorker.cjs 的顺序）；
// - Folia 对上游的修改：只有 randomCNIP 的请求才带伪造的来源 IP；扫码两步网络失败时重发一次；替换 login_qr_check。
import ncmGlobalShared from './shims/global.cjs';
import { existsSync, readFileSync, writeFileSync } from './shims/fs';

type Cookie = Record<string, string>;
type Query = Record<string, unknown> & { cookie: Cookie };
interface Answer { status: number; body: unknown; cookie?: string[] }
type NcmRequest = (uri: string, data: Record<string, unknown>, options?: Record<string, unknown>) => Promise<Answer>;
type NcmModule = (query: Query, request: NcmRequest) => Promise<Answer>;
type Loader = () => Promise<{ default: unknown }>;

/** 上游包里各文件共用的 global（shims/global.cjs）：上游 server.js 启动时往上写的两项。 */
const ncmGlobal = ncmGlobalShared as { cnIp?: string; deviceId?: string };

const TOKEN_FILE = '/tmp/anonymous_token';
const XEAPI_KEY_FILE = '/tmp/xeapi_public_key';
const STARTUP_TIMEOUT_MS = 10000;

// Folia 用到的接口（sources/netease/core 里的全部路径）。路径与文件名的对应同上游 server.js：下划线换成斜杠，
// fm_trash 与 personal_fm 例外。登录状态检查（login/qr/check）用下面 Folia 自己的版本。
const ROUTES: Record<string, Loader> = {
    '/album': () => import('@neteasecloudmusicapienhanced/api/module/album.js'),
    '/album/detail/dynamic': () => import('@neteasecloudmusicapienhanced/api/module/album_detail_dynamic.js'),
    '/album/new': () => import('@neteasecloudmusicapienhanced/api/module/album_new.js'),
    '/album/sub': () => import('@neteasecloudmusicapienhanced/api/module/album_sub.js'),
    '/album/sublist': () => import('@neteasecloudmusicapienhanced/api/module/album_sublist.js'),
    '/artist/album': () => import('@neteasecloudmusicapienhanced/api/module/artist_album.js'),
    '/artist/detail': () => import('@neteasecloudmusicapienhanced/api/module/artist_detail.js'),
    '/artist/songs': () => import('@neteasecloudmusicapienhanced/api/module/artist_songs.js'),
    '/artist/top/song': () => import('@neteasecloudmusicapienhanced/api/module/artist_top_song.js'),
    '/cloud/lyric/get': () => import('@neteasecloudmusicapienhanced/api/module/cloud_lyric_get.js'),
    '/cloudsearch': () => import('@neteasecloudmusicapienhanced/api/module/cloudsearch.js'),
    '/fm_trash': () => import('@neteasecloudmusicapienhanced/api/module/fm_trash.js'),
    '/history/recommend/songs': () => import('@neteasecloudmusicapienhanced/api/module/history_recommend_songs.js'),
    '/history/recommend/songs/detail': () => import('@neteasecloudmusicapienhanced/api/module/history_recommend_songs_detail.js'),
    '/homepage/block/page': () => import('@neteasecloudmusicapienhanced/api/module/homepage_block_page.js'),
    '/like': () => import('@neteasecloudmusicapienhanced/api/module/like.js'),
    '/likelist': () => import('@neteasecloudmusicapienhanced/api/module/likelist.js'),
    '/login/qr/create': () => import('@neteasecloudmusicapienhanced/api/module/login_qr_create.js'),
    '/login/qr/key': () => import('@neteasecloudmusicapienhanced/api/module/login_qr_key.js'),
    '/login/status': () => import('@neteasecloudmusicapienhanced/api/module/login_status.js'),
    '/logout': () => import('@neteasecloudmusicapienhanced/api/module/logout.js'),
    '/lyric/new': () => import('@neteasecloudmusicapienhanced/api/module/lyric_new.js'),
    '/personal/fm/mode': () => import('@neteasecloudmusicapienhanced/api/module/personal_fm_mode.js'),
    '/personal_fm': () => import('@neteasecloudmusicapienhanced/api/module/personal_fm.js'),
    '/personalized': () => import('@neteasecloudmusicapienhanced/api/module/personalized.js'),
    '/playlist/detail': () => import('@neteasecloudmusicapienhanced/api/module/playlist_detail.js'),
    '/playlist/detail/dynamic': () => import('@neteasecloudmusicapienhanced/api/module/playlist_detail_dynamic.js'),
    '/playlist/subscribe': () => import('@neteasecloudmusicapienhanced/api/module/playlist_subscribe.js'),
    '/playlist/track/all': () => import('@neteasecloudmusicapienhanced/api/module/playlist_track_all.js'),
    '/playlist/tracks': () => import('@neteasecloudmusicapienhanced/api/module/playlist_tracks.js'),
    '/recommend/category/configs': () => import('@neteasecloudmusicapienhanced/api/module/recommend_category_configs.js'),
    '/recommend/category/set': () => import('@neteasecloudmusicapienhanced/api/module/recommend_category_set.js'),
    '/recommend/category/songs': () => import('@neteasecloudmusicapienhanced/api/module/recommend_category_songs.js'),
    '/recommend/resource': () => import('@neteasecloudmusicapienhanced/api/module/recommend_resource.js'),
    '/recommend/songs': () => import('@neteasecloudmusicapienhanced/api/module/recommend_songs.js'),
    '/recommend/songs/dislike': () => import('@neteasecloudmusicapienhanced/api/module/recommend_songs_dislike.js'),
    '/register/anonimous': () => import('@neteasecloudmusicapienhanced/api/module/register_anonimous.js'),
    '/scrobble/v1': () => import('@neteasecloudmusicapienhanced/api/module/scrobble_v1.js'),
    '/simi/song': () => import('@neteasecloudmusicapienhanced/api/module/simi_song.js'),
    '/song/chorus': () => import('@neteasecloudmusicapienhanced/api/module/song_chorus.js'),
    '/song/copyright/rcmd': () => import('@neteasecloudmusicapienhanced/api/module/song_copyright_rcmd.js'),
    '/song/detail': () => import('@neteasecloudmusicapienhanced/api/module/song_detail.js'),
    '/song/url/v1': () => import('@neteasecloudmusicapienhanced/api/module/song_url_v1.js'),
    '/top/playlist': () => import('@neteasecloudmusicapienhanced/api/module/top_playlist.js'),
    '/top/song': () => import('@neteasecloudmusicapienhanced/api/module/top_song.js'),
    '/toplist': () => import('@neteasecloudmusicapienhanced/api/module/toplist.js'),
    '/user/account': () => import('@neteasecloudmusicapienhanced/api/module/user_account.js'),
    '/user/cloud': () => import('@neteasecloudmusicapienhanced/api/module/user_cloud.js'),
    '/user/cloud/detail': () => import('@neteasecloudmusicapienhanced/api/module/user_cloud_detail.js'),
    '/user/playlist': () => import('@neteasecloudmusicapienhanced/api/module/user_playlist.js'),
    '/user/record': () => import('@neteasecloudmusicapienhanced/api/module/user_record.js'),
};

const load = async <T>(loader: Loader) => (await loader()).default as T;

const withTimeout = <T>(promise: Promise<T>, ms: number, label: string) => new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
});

const describe = (error: unknown) => {
    if (error instanceof Error) return error.message;
    const answer = error as Answer | undefined;
    if (answer && typeof answer === 'object' && 'status' in answer) return `status=${answer.status} ${JSON.stringify(answer.body).slice(0, 200)}`;
    return String(error);
};

// ---- 发请求：上游 util/request，加上 Folia 的两处修改 ----

const QR_RETRY_URIS = new Set(['/api/login/qrcode/unikey', '/api/login/qrcode/client/login']);

/** util/request 在网络层失败（没拿到网易云的回答）时回 502；HTTP 状态码不对的回答也是 502，但消息不同，不重发。 */
const isNetworkFailure = (error: unknown) => {
    const answer = error as Answer | undefined;
    const message = (answer?.body as { msg?: unknown } | undefined)?.msg;
    return Number(answer?.status) === 502 && !(typeof message === 'string' && message.startsWith('Request failed with status code'));
};

let requestPromise: Promise<NcmRequest> | null = null;
const getRequest = () => {
    requestPromise ??= (async () => {
        const upstream = await load<NcmRequest>(() => import('@neteasecloudmusicapienhanced/api/util/request.js'));
        // 只有显式要随机国内 IP 的请求才带伪造的来源 IP（neteaseApiStartup.cjs 的 withoutImplicitClientIp）。
        const send: NcmRequest = (uri, data, options = {}) => upstream(uri, data, {
            ...options,
            ip: options.randomCNIP ? String(ncmGlobal.cnIp ?? '') : '',
        });
        // 扫码的要码和轮询在网络层失败时隔 300ms 再发一次（withQrNetworkRetry）。上游会往 data 上写字段，每次都用副本。
        return async (uri, data = {}, options = {}) => {
            const attempt = () => send(uri, { ...data }, {
                ...options,
                ...(options.cookie && typeof options.cookie === 'object' ? { cookie: { ...(options.cookie as Cookie) } } : {}),
            });
            try {
                return await attempt();
            } catch (error) {
                if (!QR_RETRY_URIS.has(uri) || !isNetworkFailure(error)) throw error;
                await new Promise(resolve => setTimeout(resolve, 300));
                return attempt();
            }
        };
    })();
    return requestPromise;
};

// Folia 的 login_qr_check（neteaseApiStartup.cjs 的 createLoginQrCheck）：上游的版本在请求被拒绝时自己抛 ReferenceError。
const loginQrCheck: NcmModule = async (query, request) => {
    const createOption = await load<(query: Query) => Record<string, unknown>>(() => import('@neteasecloudmusicapienhanced/api/util/option.js'));
    const result = await request('/api/login/qrcode/client/login', { key: query.key, type: 3 }, createOption(query));
    return { status: 200, body: { ...(result.body as object), cookie: (result.cookie ?? []).join(';') }, cookie: result.cookie };
};

// ---- 启动：cnIp、deviceId、xeapi 公钥、匿名 token ----

interface XeapiKey { sk?: string; version?: string | number }
const readXeapiKey = (): XeapiKey | null => {
    try {
        return existsSync(XEAPI_KEY_FILE) ? JSON.parse(String(readFileSync(XEAPI_KEY_FILE, 'utf-8'))) : null;
    } catch {
        return null;
    }
};
const usableXeapiKey = (key: XeapiKey | null) => Boolean(key && typeof key.sk === 'string' && key.sk.trim());

const retry = async (label: string, operation: () => Promise<void>, attempts = 3) => {
    for (let attempt = 1; ; attempt++) {
        try {
            await withTimeout(operation(), STARTUP_TIMEOUT_MS, label);
            return;
        } catch (error) {
            if (attempt >= attempts) throw error;
            console.warn(`[netease-local] ${label} failed (attempt ${attempt}), retrying: ${describe(error)}`);
            await new Promise(resolve => setTimeout(resolve, 250 * 2 ** (attempt - 1) + Math.random() * 100));
        }
    }
};

const refreshXeapiKey = async () => {
    const { getXeapiPublicKey } = await load<{ getXeapiPublicKey: (current: XeapiKey, deviceId: string) => Promise<XeapiKey> }>(
        () => import('@neteasecloudmusicapienhanced/api/util/xeapiKey.js'),
    );
    const key = await getXeapiPublicKey(readXeapiKey() ?? {}, String(ncmGlobal.deviceId ?? ''));
    if (!usableXeapiKey(key)) throw new Error('xeapi public key response missing sk');
    writeFileSync(XEAPI_KEY_FILE, JSON.stringify(key));
};

const refreshAnonymousToken = async () => {
    const [register, request, util] = await Promise.all([
        load<NcmModule>(ROUTES['/register/anonimous']),
        getRequest(),
        load<{ cookieToJson: (cookie: string) => Cookie }>(() => import('@neteasecloudmusicapienhanced/api/util/index.js')),
    ]);
    const answer = await register({ cookie: {} }, request);
    const bodyCookie = (answer.body as { cookie?: unknown } | undefined)?.cookie;
    const cookie = typeof bodyCookie === 'string' && bodyCookie.trim() ? bodyCookie : (answer.cookie ?? []).join(';');
    const token = util.cookieToJson(cookie).MUSIC_A;
    if (!token) {
        const body = answer.body as { code?: unknown; message?: unknown; msg?: unknown } | undefined;
        throw new Error(`anonymous registration response missing MUSIC_A (status=${answer.status}, code=${body?.code}, message=${body?.message ?? body?.msg ?? ''}, keys=${Object.keys(body ?? {}).join('/')})`);
    }
    writeFileSync(TOKEN_FILE, token);
};

let ready: Promise<void> | null = null;

// 第一次用（没有存下的 xeapi 公钥 / 匿名 token）时要等它们准备好；之后直接用存下的，在后台刷新（新的下次打开 App 生效，
// 和桌面端一样：上游在第一次用到时才读这两个文件，读过就不再读）。
const start = async () => {
    const util = await load<{ generateRandomChineseIP: () => string; generateDeviceId: () => string }>(
        () => import('@neteasecloudmusicapienhanced/api/util/index.js'),
    );
    ncmGlobal.cnIp = util.generateRandomChineseIP();
    ncmGlobal.deviceId ??= util.generateDeviceId();

    const keyTask = retry('xeapi public key refresh', refreshXeapiKey);
    if (usableXeapiKey(readXeapiKey())) {
        keyTask.catch(error => console.warn(`[netease-local] keeping the stored xeapi key: ${describe(error)}`));
    } else {
        await keyTask;
    }

    const tokenTask = retry('anonymous registration', refreshAnonymousToken);
    if (String(readFileSync(TOKEN_FILE, 'utf-8'))) {
        tokenTask.catch(error => console.warn(`[netease-local] keeping the stored anonymous token: ${describe(error)}`));
    } else {
        await tokenTask.catch(error => console.warn(`[netease-local] anonymous registration failed: ${describe(error)}`));
    }
};

const ensureStarted = () => {
    ready ??= start().catch((error) => {
        ready = null; // 下一个请求再试（例如刚才没网）
        throw error;
    });
    return ready;
};

// ---- 回答一个请求（上游 server.js 的路由处理） ----

const json = (status: number, body: unknown) => {
    const safeStatus = status >= 200 && status <= 599 ? status : 500;
    if (typeof body === 'string') return new Response(body, { status: safeStatus, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    if (body instanceof Uint8Array) return new Response(body as Uint8Array<ArrayBuffer>, { status: safeStatus });
    return new Response(JSON.stringify(body ?? null), { status: safeStatus, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
};

const decode = (value: string) => {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
};

const abortError = () => new DOMException('The operation was aborted.', 'AbortError');

const untilAborted = <T>(promise: Promise<T>, signal?: AbortSignal | null) => {
    if (!signal) return promise;
    if (signal.aborted) return Promise.reject(abortError());
    return new Promise<T>((resolve, reject) => {
        const onAbort = () => reject(abortError());
        signal.addEventListener('abort', onAbort, { once: true });
        promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
    });
};

const bodyParams = async (init?: RequestInit) => {
    const body = init?.body;
    if (!body) return {};
    const text = typeof body === 'string' ? body : body instanceof URLSearchParams ? body.toString() : '';
    if (!text) return {};
    try {
        return JSON.parse(text) as Record<string, unknown>;
    } catch {
        return Object.fromEntries(new URLSearchParams(text));
    }
};

export const handle = async (input: string, init?: RequestInit): Promise<Response> => {
    const url = new URL(input);
    const route = url.pathname.replace(/\/+$/, '') || '/';
    const loader = ROUTES[route];
    if (!loader && route !== '/login/qr/check') return json(404, { code: 404, data: null, msg: 'Not Found' });

    const params: Record<string, unknown> = { ...Object.fromEntries(url.searchParams), ...(await bodyParams(init)) };
    const util = await load<{ cookieToJson: (cookie: string) => Cookie }>(() => import('@neteasecloudmusicapienhanced/api/util/index.js'));
    const cookie = typeof params.cookie === 'string' ? util.cookieToJson(decode(params.cookie)) : {};
    const query: Query = { ...params, cookie };

    try {
        await untilAborted(ensureStarted(), init?.signal);
        const [module, request] = await Promise.all([
            loader ? load<NcmModule>(loader) : Promise.resolve(loginQrCheck),
            getRequest(),
        ]);
        const answer = await untilAborted(module(query, request), init?.signal);
        return json(answer.status, answer.body);
    } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
        const answer = error as Answer | undefined;
        if (!answer || typeof answer !== 'object' || !('body' in answer) || !answer.body) {
            console.warn(`[netease-local] ${route} failed: ${describe(error)}`);
            return json(404, { code: 404, data: null, msg: 'Not Found' });
        }
        const body = answer.body as { code?: unknown; msg?: unknown };
        if (body && typeof body === 'object' && String(body.code) === '301') body.msg = '需要登录';
        return json(Number(answer.status) || 500, answer.body);
    }
};

/** 测试与诊断用：当前的运行时状态（不含任何凭据）。 */
export const describeState = () => ({
    deviceId: Boolean(ncmGlobal.deviceId),
    cnIp: Boolean(ncmGlobal.cnIp),
    xeapiKeyVersion: readXeapiKey()?.version ?? null,
    anonymousToken: Boolean(String(readFileSync(TOKEN_FILE, 'utf-8'))),
});
