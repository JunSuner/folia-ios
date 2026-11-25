import { RUN_STYLES as STYLES, WINDOW, loadState, orientation, report, saveState, stageUrl, summarize, viewport, type StyleResult } from './perfPlan';

// ios/perf/stageDriver.ts
// 跑在测量页里：等 dev/perf/stage.tsx 准备好，播放测试曲的测量段并记录帧间隔，存结果后跳到下一个样式。

interface PerfWindowReport { elapsedMs: number; frameGapsMs: number[] }
interface PerfApi {
    ready: Promise<void>;
    info: () => Record<string, unknown>;
    playFrom: (s: number) => Promise<void>;
    pause: () => void;
    waitForSongTime: (s: number) => Promise<void>;
    startWindow: () => void;
    endWindowAfter: (s: number) => Promise<PerfWindowReport>;
}

const withTimeout = <T>(promise: Promise<T>, ms: number, what: string) => Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${what} 超时 ${ms / 1000}s`)), ms)),
]);

const waitForApi = async (): Promise<PerfApi> => {
    for (let i = 0; i < 600; i++) {
        const api = (window as unknown as { __perf?: PerfApi }).__perf;
        if (api) return api;
        await new Promise(r => setTimeout(r, 50));
    }
    throw new Error('测量页 30 秒内没有启动');
};

const run = async () => {
    const state = loadState();
    if (!state) return;
    const [style, name, drawsWith] = STYLES[state.index];
    const result: StyleResult = { style, name, drawsWith, windows: [], gaps: [] };
    let pageError = '';
    window.addEventListener('error', e => { pageError ||= String(e.message); });
    window.addEventListener('unhandledrejection', e => { pageError ||= String((e.reason as Error)?.message ?? e.reason); });
    try {
        const api = await waitForApi();
        await withTimeout(api.ready, 60000, '样式加载');
        result.orientation = orientation();
        result.viewport = viewport();
        for (let w = 0; w < WINDOW.windows; w++) {
            const lead = w === 0 ? WINDOW.firstWarmSeconds : WINDOW.preRollSeconds;
            await withTimeout(api.playFrom(WINDOW.startSeconds - lead), 15000, '开始播放');
            await withTimeout(api.waitForSongTime(WINDOW.startSeconds), 30000, '等待测量段');
            api.startWindow();
            const win = await withTimeout(api.endWindowAfter(WINDOW.lengthSeconds), 30000, '测量');
            result.windows.push(summarize(win.frameGapsMs, win.elapsedMs));
            result.gaps!.push(win.frameGapsMs.map(g => Math.round(g * 10) / 10));
        }
        api.pause();
        result.info = api.info();
        if (orientation() !== result.orientation || result.orientation !== state.orientation) result.rotated = true;
    } catch (error) {
        result.error = `${(error as Error).message}${pageError ? ` / 页面错误: ${pageError}` : ''}`;
        (result as StyleResult & { log?: string[] }).log = [...((window as unknown as { __iosPerfEarly?: string[] }).__iosPerfEarly ?? []), ...((window as unknown as { __iosPerfLog?: string[] }).__iosPerfLog ?? [])];
    }
    if (result.error && state.retriedIndex !== state.index) {
        await report('result', { runId: state.runId, index: state.index, retry: true, ...result });
        state.retriedIndex = state.index;
        saveState(state);
        window.location.replace(stageUrl(state.index));
        return;
    }
    await report('result', { runId: state.runId, index: state.index, ...result });
    delete result.gaps;
    state.results.push(result);
    state.index += 1;
    saveState(state);
    window.location.replace(state.index < STYLES.length ? stageUrl(state.index) : '/index.html?done=1');
};

void run();
