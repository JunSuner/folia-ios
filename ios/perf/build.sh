#!/bin/bash
# 构建真机性能测试版的网页并放进 iOS 工程（ios/App/App/public）。
# 收集服务地址默认取 .env.capacitor 里后端的主机名，端口 3399；也可以用 PERF_COLLECTOR 指定。
# 测完用 `npx cap copy ios` 把正式版网页换回来。
set -e
cd "$(dirname "$0")/../.."
if [ -z "$PERF_COLLECTOR" ] && [ -f .env.capacitor ]; then
    HOST=$(grep -E '^VITE_NETEASE_API_BASE=' .env.capacitor | sed -E 's#^[^=]+=https?://([^:/]+).*#\1#')
    PERF_COLLECTOR="http://$HOST:3399"
fi
echo "collector: ${PERF_COLLECTOR:-<none>}"
node dev/perf/song.mjs >/dev/null
VITE_PERF_COLLECTOR="$PERF_COLLECTOR" VITE_PERF_AUTOSTART="${PERF_AUTOSTART:-}" VITE_PERF_LIMIT="${PERF_LIMIT:-}" npx vite build -c ios/perf/vite.config.ts --logLevel warn
OUT=ios/perf/.build/dist
cp "$OUT/ios/perf/index.html" "$OUT/index.html"
mkdir -p "$OUT/perf-song" && cp dev/perf/.build/public/* "$OUT/perf-song/"
rm -rf ios/App/App/public && cp -R "$OUT" ios/App/App/public
echo "perf web: $(du -sh ios/App/App/public | cut -f1)"
