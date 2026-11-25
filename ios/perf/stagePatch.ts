const early: string[] = [];
const keepEarly = (line: string) => { if (early.length < 80) early.push(line); console.info(`[ios-perf] ${line}`); };
(window as unknown as { __iosPerfEarly: string[] }).__iosPerfEarly = early;
// ios/perf/stagePatch.ts
// 在测量页之前加载：Capacitor 的本地文件服务给 .wav 的 MIME 类型不对，WebKit 会把 blob 当成 WebM 解码失败，
// dev/perf/stage.tsx 就一直等不到测试曲加载完。这里在取 song.wav 时补上 audio/wav。
const originalFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await originalFetch(input, init);
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    keepEarly(`fetch ${url.split('/').pop()} ${response.status} ${response.headers.get('content-type')}`);
    if (!url.endsWith('/song.wav')) return response;
    const buffer = await response.arrayBuffer();
    return new Response(new Blob([buffer], { type: 'audio/wav' }), { status: 200, headers: { 'Content-Type': 'audio/wav' } });
};

// 收集页面自己的报错和 console 输出，测量失败时一并上报，方便定位（真机上看不到控制台）。
const log: string[] = [];
(window as unknown as { __iosPerfLog: string[] }).__iosPerfLog = log;
const keep = (level: string, args: unknown[]) => {
    if (log.length < 40) log.push(`${level}: ${args.map(a => a instanceof Error ? `${a.name}: ${a.message}` : typeof a === 'string' ? a : JSON.stringify(a)).join(' ').slice(0, 300)}`);
};
for (const level of ['log', 'warn', 'error'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => { keep(level, args); original(...args); };
}
window.addEventListener('error', e => keep('onerror', [e.message, `${e.filename}:${e.lineno}`]));
window.addEventListener('unhandledrejection', e => keep('rejection', [e.reason]));

// 跟踪音频元素的加载事件：iOS 上不点一下屏幕，媒体可能根本不开始加载。
const OriginalAudio = window.Audio;
window.Audio = function (src?: string) {
    const audio = new OriginalAudio(src);
    // 预加载期间先拦住 canplaythrough，免得测量页提前开始、又被预加载的 pause/归零打断。
    let priming = false;
    audio.addEventListener("canplaythrough", e => { if (priming && e.isTrusted) e.stopImmediatePropagation(); });
    for (const type of ['loadstart', 'loadedmetadata', 'canplay', 'canplaythrough', 'error', 'suspend', 'stalled', 'play', 'playing', 'pause', 'seeking', 'seeked', 'waiting']) {
        audio.addEventListener(type, () => keepEarly(`audio ${type} ready=${audio.readyState} net=${audio.networkState} err=${audio.error?.code ?? ''}`));
    }
    // iOS 在播放前只读到元数据就停（suspend），canplaythrough 不会来；只有元数据时跳进度，真机上这次 seek 会一直挂着，
    // play() 永远不返回。所以元数据到了先静音播一下再暂停，让 iOS 把数据真正读进来，真的 canplaythrough 才会来。
    audio.addEventListener("loadedmetadata", () => {
        if (audio.readyState >= 4) return;
        keepEarly("prime: muted play");
        priming = true;
        audio.muted = true;
        const release = (note: string) => { audio.muted = false; priming = false; keepEarly(note); audio.dispatchEvent(new Event("canplaythrough")); };
        audio.play().then(() => { audio.pause(); audio.currentTime = 0; release(`prime done ready=${audio.readyState}`); },
            (e: Error) => release(`prime failed ${e?.name}`));
    }, { once: true });
    return audio;
} as unknown as typeof Audio;

// 真机上"开始播放"会卡住：记录 AudioContext.resume() 和 audio.play() 的进展，同时打到 console，
// 用 devicectl 的 --console 就能在 Mac 上直接看到，不依赖收集器。
const say = keepEarly;
say(`audioSession=${(navigator as unknown as { audioSession?: { type: string } }).audioSession?.type ?? 'n/a'}`);
const OriginalContext = window.AudioContext;
window.AudioContext = class extends OriginalContext {
    constructor(options?: AudioContextOptions) {
        super(options);
        say(`ctx new state=${this.state} rate=${this.sampleRate}`);
        this.addEventListener('statechange', () => say(`ctx state -> ${this.state}`));
    }
} as typeof AudioContext;
const watch = <T>(what: string, promise: Promise<T>, describe: () => string, onStall?: () => void) => {
    const t0 = performance.now();
    const ms = () => Math.round(performance.now() - t0);
    say(`${what} start ${describe()}`);
    const timer = setInterval(() => { say(`${what} pending ${ms()}ms ${describe()}`); onStall?.(); }, 3000);
    promise.then(() => say(`${what} ok ${ms()}ms ${describe()}`), (e: Error) => say(`${what} err ${ms()}ms ${e?.name}: ${e?.message} ${describe()}`))
        .finally(() => clearInterval(timer));
    return promise;
};
const originalResume = AudioContext.prototype.resume;
AudioContext.prototype.resume = function (this: AudioContext) {
    return watch('ctx.resume', originalResume.call(this), () => `state=${this.state}`);
};
const originalPlay = HTMLMediaElement.prototype.play;
HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
    return watch('audio.play', originalPlay.call(this), () => `ready=${this.readyState} net=${this.networkState} t=${this.currentTime.toFixed(2)} paused=${this.paused} seeking=${this.seeking}`,
        // 保险：seek 挂住超过 3 秒就重新跳一次。
        () => { if (this.seeking) { say("seek stuck, kick"); this.currentTime = this.currentTime; } });
};
