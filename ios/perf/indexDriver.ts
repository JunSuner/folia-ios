import { RUN_STYLES as STYLES, loadState, report, saveState, stageUrl } from './perfPlan';

// ios/perf/indexDriver.ts
// 性能测试版的首页：点"开始测试"后依次进入每个样式的测量页；全部测完回到这里显示结果表，并把汇总发回 Mac。

const status = document.getElementById('status')!;
const startButton = document.getElementById('start') as HTMLButtonElement;
const table = document.getElementById('results') as HTMLTableElement;

const device = () => ({
    userAgent: navigator.userAgent,
    devicePixelRatio: window.devicePixelRatio,
    screen: `${screen.width}x${screen.height}`,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    cores: navigator.hardwareConcurrency,
});

const grade = (fps: number, refresh: number) => {
    const ratio = fps / (1000 / refresh);
    return ratio >= 0.95 ? 'good' : ratio >= 0.8 ? 'mid' : 'bad';
};

const state = loadState();
if (state && state.index >= STYLES.length) {
    const tbody = table.tBodies[0];
    for (const r of state.results) {
        const row = tbody.insertRow();
        if (r.error || !r.windows.length) {
            row.innerHTML = `<td>${r.name}</td><td colspan="4" class="bad">${r.error ?? '无数据'}</td>`;
            continue;
        }
        const fps = Math.min(...r.windows.map(w => w.fps));
        const p95 = Math.max(...r.windows.map(w => w.p95Ms));
        const drop = Math.max(...r.windows.map(w => w.droppedPct));
        const max = Math.max(...r.windows.map(w => w.maxMs));
        row.innerHTML = `<td>${r.name}</td><td class="${grade(fps, r.windows[0].refreshMs)}">${fps}</td><td>${p95} ms</td><td>${drop}%</td><td>${max} ms</td>`;
    }
    table.hidden = false;
    status.textContent = `测完了，共 ${state.results.length} 种样式。结果已发回 Mac。`;
    startButton.textContent = '再测一次';
    void report('done', { runId: state.runId, device: device(), results: state.results });
    saveState(null);
}

startButton.addEventListener('click', async () => {
    const runId = new Date().toISOString().replace(/[:.]/g, '-');
    saveState({ runId, index: 0, results: [] });
    await report('start', { runId, device: device(), styles: STYLES.length });
    window.location.replace(stageUrl(0));
});

// 模拟器冒烟测试用：构建时设 VITE_PERF_AUTOSTART=1 自动开始，不用点按钮。
if (import.meta.env.VITE_PERF_AUTOSTART === '1' && !loadState() && !sessionStorage.getItem('folia-ios-perf-autostarted')) {
    sessionStorage.setItem('folia-ios-perf-autostarted', '1');
    setTimeout(() => startButton.click(), 1000);
}
