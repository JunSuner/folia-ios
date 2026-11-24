# Folia iOS 移植

这是 [chthollyphile/folia-major](https://github.com/chthollyphile/folia-major) 的 iOS 移植，用 [Capacitor](https://capacitorjs.com/) 把 Folia 的网页版装进原生壳里。上游的代码、署名和 AGPL-3.0 许可证原样保留，本目录只放 iOS 相关的部分。

> 本项目仅供个人学习、技术交流与非营利测试使用。音乐、歌词和封面的版权归各自权利人所有。

## 现状

- 已完成：iOS 壳（Swift Package Manager，无需 CocoaPods）、网易云接入（扫码登录、歌单、歌词）、真机安装。
- 进行中：原生播放（后台播放、锁屏控制）、歌词动画在手机上的性能调优。
- 暂不支持：本地音乐、QQ 音乐、酷狗，以及桌面端独有的功能（壁纸模式、窗口置顶、全局快捷键等）。

## 需要准备

- 一台 Mac，装好 Xcode 和 Node.js 24 以上。
- 一个网易云 API 后端：[@neteasecloudmusicapienhanced/api](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced)，部署在国内网络环境，手机要能访问到（比如经 Tailscale）。海外服务器会被网易云按地区限制。
  - 如果用 Node 24 跑后端且 IPv6 不通，启动参数加上 `--dns-result-order=ipv4first --no-network-family-autoselection`，否则扫码登录会间歇性报 404。
- 一个 Apple ID。免费账号也能装到真机，但签名 7 天后过期，需要重新安装。

## 构建

```bash
npm install
cp .env.capacitor.example .env.capacitor   # 填入你的后端地址
npm run build:ios                          # 构建网页并同步进 ios/
npm run open:ios                           # 用 Xcode 打开，选设备后运行
```

命令行装到真机：在 `ios/App/local.xcconfig` 里写上你的 `DEVELOPMENT_TEAM`（这个文件不会被提交），然后运行

```bash
ios/scripts/gui-run.sh "$PWD/ios/scripts/device-run.sh" <设备 UDID>
```

`gui-run.sh` 会把构建放进 Mac 的图形界面会话里执行。通过 SSH 构建时登录钥匙串是锁着的，没法签名，这样就能绕开。
