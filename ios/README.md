# Folia iOS 移植

这是 [chthollyphile/folia-major](https://github.com/chthollyphile/folia-major) 的 iOS 移植，用 [Capacitor](https://capacitorjs.com/) 把 Folia 的网页版装进原生壳里。上游的代码、署名和 AGPL-3.0 许可证原样保留，本目录只放 iOS 相关的部分。

> 本项目仅供个人学习、技术交流与非营利测试使用。音乐、歌词和封面的版权归各自权利人所有。

## 现状

- 已完成：iOS 壳（Swift Package Manager，无需 CocoaPods）、网易云接入（扫码登录、歌单、歌词），手机直接连网易云，不需要另外部署后端；
  网易云的歌用原生播放器放（切到后台、锁屏照样放，锁屏和控制中心能控制）；真机安装。
- 进行中：手机上的界面（竖屏、触控）、歌词动画在手机上的性能调优。
- 暂不支持：本地音乐、QQ 音乐、酷狗，以及桌面端独有的功能（壁纸模式、窗口置顶、全局快捷键等）。

## 需要准备

- 一台 Mac，装好 Xcode 和 Node.js 24 以上。
- 一个 Apple ID。免费账号也能装到真机，但签名 7 天后过期，需要重新安装。

## 构建

```bash
npm install
cp .env.capacitor.example .env.capacitor   # 默认手机直连网易云，一般不用改
npm run build:ios                          # 构建网页并同步进 ios/
npm run open:ios                           # 用 Xcode 打开，选设备后运行
```

命令行装到真机：在 `ios/App/local.xcconfig` 里写上你的 `DEVELOPMENT_TEAM`（这个文件不会被提交），然后运行

```bash
ios/scripts/gui-run.sh "$PWD/ios/scripts/device-run.sh" <设备 UDID>
```

`gui-run.sh` 会把构建放进 Mac 的图形界面会话里执行。通过 SSH 构建时登录钥匙串是锁着的，没法签名，这样就能绕开。

## 网易云怎么连

Folia 自己不直接和网易云通信，而是经过第三方库 [@neteasecloudmusicapienhanced/api](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced)：它负责网易云的几套加密、模拟官方客户端的请求头和 Cookie。桌面版把这个库跑在应用内的 Node 线程里；iOS 上没有 Node，所以：

- **默认：手机直连**（`ios/netease-local/`）。把这个库原样打进 App，其中用到的 Node 模块换成手机能跑的替身（`shims/`：加密用 [noble](https://paulmillr.com/noble/) 的纯 JS 实现，文件换成本地存储），网络请求交给原生插件 `ios/App/App/NeteaseHttpPlugin.swift`（URLSession，不受 WebView 跨域限制）。页面发往 `http://netease.folia.local` 的请求由 `bootstrap.js` 截下，转给 `server.ts` 在手机上处理。
  - 用到的接口列在 `server.ts` 的 `ROUTES` 里；Folia 新用到别的接口时在那里加一行。
  - 升级这个库后跑 `node ios/netease-local/test/compare.mjs`：在 Mac 上用 Node 运行打包好的手机版，和一个自建服务比对同一组匿名请求的结果（默认 `http://127.0.0.1:3300`，用 `NETEASE_REMOTE` 改）。
  - 收藏歌单需要的反作弊 token（上游用 jsdom 生成）暂不支持。
- **备用：自建服务**。在 `.env.capacitor` 里把 `VITE_NETEASE_API_BASE` 改成服务的地址（例如 Mac 上用 launchd 跑这个库，手机经 Tailscale 访问）。服务要在国内网络环境，海外服务器会被网易云按地区限制；用 Node 24 且 IPv6 不通时，启动参数加上 `--dns-result-order=ipv4first --no-network-family-autoselection`，否则扫码登录会间歇性报 404。

## 歌怎么放

网易云的歌不经过网页里的 `<audio>`，交给 App 的原生播放器 `ios/App/App/NativePlayerPlugin.swift`（AVQueuePlayer）：

- 页面一侧用的是 Folia 现成的「外部播放器」通道（`playback.external@1`，`src/services/onlineMusic/externalPlayback.ts`）：宿主告诉播放器放哪首、怎么走，每半秒问一次位置，歌词和进度条跟着它走。网易云音源在页面里有 `window.FoliaNativePlayer`（`ios/native-player/bridge.js`）时走这条路，见 `sources/netease/core/neteaseNativePlayback.ts`。
- 宿主会把随后的一两首交给播放器排着，放完自己接上（App 在后台、页面被系统冻住时也接得上）；页面醒来后认领正在放的那首。
- 锁屏和控制中心的「正在播放」、耳机和锁屏按键在原生这边：播放、暂停、拖进度、排着下一首时的「下一首」直接处理；「上一首」和没排下一首时的「下一首」转给页面的 Media Session 处理函数。
- 无损（FLAC）要开 `AVURLAssetPreferPreciseDurationAndTimingKey`：不开时跳转按码率估算，报的时间和实际放到的地方差得出 20 秒以上。
- 这条路不经过 Web Audio，所以均衡器、频谱、交叉淡入淡出、ReplayGain 对网易云的歌不生效（和桌面版的 HiFi 路线一样）。
