// ios/netease-local/shims/process.cjs
// 只注入给网易云 API 包的 process（不挂到 window 上，免得 Folia 自己把 App 当成 Node/Electron）。
// 包读 process.env 里的几个开关（NETEASE_COOKIE、ENABLE_RANDOM_CN_IP 等），在手机上都不设。
module.exports = {
    env: {},
    platform: 'ios',
    version: '',
    versions: {},
    argv: [],
    cwd: () => '/',
    nextTick: (fn, ...args) => queueMicrotask(() => fn(...args)),
};
