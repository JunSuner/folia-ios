import { ORIENTATION_NAME, RUN_STYLES as STYLES, loadState, orientation, report, saveState, stageUrl, viewport } from './perfPlan';

// ios/perf/indexDriver.ts
// 性能测试版的首页：点"开始测试"后依次进入每个样式的测量页；全部测完回到这里显示结果表，并把汇总发回 Mac。
// 横屏、竖屏分开测：按钮跟着手机当前方向变，测完一种方向提示转过来再测另一种。

const status = document.getElementById('status')!;
const startButton = document.getElementById('start') as HTMLButtonElement;
const table = document.getElementById('results') as HTMLTableElement;

const device = () => ({
    userAgent: navigator.userAgent,
    devicePixelRatio: window.devicePixelRatio,
    screen: `${screen.width}x${screen.height}`,
    viewport: viewport(),
    orientation: orientation(),
    cores: navigator.hardwareConcurrency,
});

const grade = (fps: number, refresh: number) => {
    const ratio = fps / (1000 / refresh);
    return ratio >= 0.95 ? 'good' : ratio >= 0.8 ? 'mid' : 'bad';
};

const updateButton = () => { startButton.textContent = `开始${ORIENTATION_NAME[orientation()]}测试`; };
updateButton();
window.addEventListener('resize', updateButton);

const state = loadState();
if (state && state.index >= STYLES.length) {
    const tbody = table.tBodies[0];
    for (const r of state.results) {
        const row = tbody.insertRow();
        const name = `${r.name}${r.rotated ? ' ⚠转屏' : ''}`;
        if (r.error || !r.windows.length) {
            row.innerHTML = `<td>${name}</td><td colspan="4" class="bad">${r.error ?? '无数据'}</td>`;
            continue;
        }
        const fps = Math.min(...r.windows.map(w => w.fps));
        const p95 = Math.max(...r.windows.map(w => w.p95Ms));
        const drop = Math.max(...r.windows.map(w => w.droppedPct));
        const max = Math.max(...r.windows.map(w => w.maxMs));
        row.innerHTML = `<td>${name}</td><td class="${grade(fps, r.windows[0].refreshMs)}">${fps}</td><td>${p95} ms</td><td>${drop}%</td><td>${max} ms</td>`;
    }
    table.hidden = false;
    const done = ORIENTATION_NAME[state.orientation];
    const other = ORIENTATION_NAME[state.orientation === 'portrait' ? 'landscape' : 'portrait'];
    status.textContent = `${done}测完了，共 ${state.results.length} 种样式。正在发回 Mac…`;
    void report('done', { runId: state.runId, orientation: state.orientation, device: device(), results: state.results }).then(sent => {
        status.textContent = `${done}测完了，共 ${state.results.length} 种样式。${sent ? '结果已发回 Mac。' : '结果没能发回 Mac（检查 Tailscale 是否开着）。'}`
            + `要测${other}的话：关掉控制中心里的"竖排方向锁定"，把手机转成${other}，再点下面的按钮。`;
    });
    saveState(null);
}

startButton.addEventListener('click', async () => {
    const now = orientation();
    const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${now}`;
    saveState({ runId, orientation: now, index: 0, results: [] });
    await report('start', { runId, orientation: now, device: device(), styles: STYLES.length });
    window.location.replace(stageUrl(0));
});

// 冒烟测试用：构建时设 VITE_PERF_AUTOSTART=1 自动开始，不用点按钮。
if (import.meta.env.VITE_PERF_AUTOSTART === '1' && !loadState() && !sessionStorage.getItem('folia-ios-perf-autostarted')) {
    sessionStorage.setItem('folia-ios-perf-autostarted', '1');
    setTimeout(() => startButton.click(), 1000);
}
