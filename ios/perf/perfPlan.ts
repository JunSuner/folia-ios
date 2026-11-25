// ios/perf/perfPlan.ts
// 真机性能测试的公共部分：要测的样式、测量方式、跨页面保存进度（sessionStorage；dev/perf/page.tsx 每次会清空
// localStorage，所以不能放那里）、帧间隔统计，以及把结果发回 Mac 上的收集服务。

/** [id, App 里显示的名字, 绘制方式]，与 dev/perf/scenarios.mjs 的 STYLES 一致。 */
export const STYLES: Array<[string, string, string]> = [
    ['classic', 'Luminous', 'DOM'],
    ['sonnet', '商籁', 'Pixi'],
    ['tempera', 'Tempera', 'Pixi'],
    ['lumiere', '绘光', 'Pixi'],
    ['hanabi', '花火', 'Pixi'],
    ['machi', '町景', 'three.js'],
    ['nebbia', '雾笺', 'WebGL2 + 2D'],
    ['metaphor', '隐喻', 'three.js'],
    ['cadenza', 'Mindscape', 'DOM + 2D'],
    ['partita', '云阶', 'DOM'],
    ['fume', 'Fume', 'DOM + 2D'],
    ['tilt', 'Tilt', 'DOM'],
    ['claddagh', 'Claddagh', 'DOM'],
    ['monet', 'Monet', 'DOM + 2D'],
    ['pendolo', 'Pendolo', 'DOM + 2D'],
    ['cappella', 'Cappella', 'DOM'],
    ['diorama', '镜台', 'three.js'],
    ['still', 'Still', 'DOM'],
];

export const BACKGROUND = 'latent';
/** 构建时设 VITE_PERF_LIMIT=n 只测前 n 种（冒烟测试用）。 */
const LIMIT = Number(import.meta.env.VITE_PERF_LIMIT ?? 0);
export const RUN_STYLES = LIMIT > 0 ? STYLES.slice(0, LIMIT) : STYLES;
/** 测试曲里固定的 8 秒测量段（dev/perf/song.mjs 的 WINDOW），先预热 6 秒，第二段前回退 2 秒。 */
export const WINDOW = { startSeconds: 40, lengthSeconds: 8, firstWarmSeconds: 6, preRollSeconds: 2, windows: 2 };

/** 横竖屏分开测：JS 没法强制旋转，用户自己转手机，每条结果记下当时的方向和画面尺寸。 */
export type Orientation = "portrait" | "landscape";
export const orientation = (): Orientation => (window.innerWidth > window.innerHeight ? "landscape" : "portrait");
export const ORIENTATION_NAME: Record<Orientation, string> = { portrait: "竖屏", landscape: "横屏" };
export const viewport = () => `${window.innerWidth}x${window.innerHeight}@${window.devicePixelRatio}`;

export const COLLECTOR = String(import.meta.env.VITE_PERF_COLLECTOR ?? '');

export interface WindowSummary {
    frames: number;
    elapsedMs: number;
    fps: number;
    refreshMs: number;
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
    maxMs: number;
    droppedPct: number;
}

export interface StyleResult {
    style: string;
    name: string;
    drawsWith: string;
    windows: WindowSummary[];
    gaps?: number[][];
    info?: Record<string, unknown>;
    error?: string;
    orientation?: Orientation;
    viewport?: string;
    /** 测量过程中转了屏幕，这条数据不可信。 */
    rotated?: boolean;
}

export interface RunState {
    runId: string;
    orientation: Orientation;
    index: number;
    results: StyleResult[];
}

const KEY = 'folia-ios-perf';

export const loadState = (): RunState | null => {
    try {
        return JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as RunState | null;
    } catch {
        return null;
    }
};

export const saveState = (state: RunState | null) => {
    if (state) sessionStorage.setItem(KEY, JSON.stringify(state));
    else sessionStorage.removeItem(KEY);
};

export const stageUrl = (index: number) =>
    `/ios/perf/stage.html?scenario=${encodeURIComponent(JSON.stringify({ style: STYLES[index][0], background: BACKGROUND }))}`;

const quantile = (sorted: number[], q: number) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 0;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** 帧间隔统计：刷新间隔取中位数；一个间隔里多出来的刷新周期都算掉帧。 */
export const summarize = (gaps: number[], elapsedMs: number): WindowSummary => {
    const sorted = [...gaps].sort((a, b) => a - b);
    const refreshMs = quantile(sorted, 0.5) || 16.7;
    const dropped = gaps.reduce((sum, gap) => sum + Math.max(0, Math.round(gap / refreshMs) - 1), 0);
    return {
        frames: gaps.length,
        elapsedMs: Math.round(elapsedMs),
        fps: round1(gaps.length / (elapsedMs / 1000)),
        refreshMs: round1(refreshMs),
        p50Ms: round1(refreshMs),
        p95Ms: round1(quantile(sorted, 0.95)),
        p99Ms: round1(quantile(sorted, 0.99)),
        maxMs: round1(sorted[sorted.length - 1] ?? 0),
        droppedPct: round1((dropped / Math.max(1, gaps.length + dropped)) * 100),
    };
};

/** 发给 Mac 上的收集服务；连不上不影响测试本身。返回是否发送成功。 */
export const report = async (kind: 'start' | 'result' | 'done', body: unknown): Promise<boolean> => {
    if (!COLLECTOR) return false;
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 4000);
        const response = await fetch(`${COLLECTOR}/${kind}`, { method: 'POST', body: JSON.stringify(body), signal: controller.signal });
        clearTimeout(timer);
        return response.ok;
    } catch (error) {
        console.warn('[ios-perf] report failed', error);
        return false;
    }
};
