const early: string[] = [];
const keepEarly = (line: string) => { if (early.length < 40) early.push(line); };
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
    for (const type of ['loadstart', 'loadedmetadata', 'canplay', 'canplaythrough', 'error', 'suspend', 'stalled', 'play', 'playing']) {
        audio.addEventListener(type, () => keepEarly(`audio ${type} ready=${audio.readyState} net=${audio.networkState} err=${audio.error?.code ?? ''}`));
    }
    // iOS 在播放前只读到元数据就停（suspend），canplaythrough 不会来；测试曲是内存里的 blob，元数据到了就能播。
    audio.addEventListener('loadedmetadata', () => {
        if (audio.readyState < 4) {
            keepEarly('synthetic canplaythrough');
            audio.dispatchEvent(new Event('canplaythrough'));
        }
    }, { once: true });
    return audio;
} as unknown as typeof Audio;
