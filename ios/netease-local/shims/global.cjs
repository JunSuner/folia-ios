// ios/netease-local/shims/global.cjs
// 网易云 API 包把运行时状态放在 Node 的 global 上（global.deviceId、global.cnIp）。这里给它一个独立的对象，
// server.ts 读写的也是这一个。
module.exports = {};
