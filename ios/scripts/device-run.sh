#!/bin/bash
# 真机构建 + 安装 + 启动；由 gui-run.sh 放进 GUI 会话里跑，这样能用已解锁的登录钥匙串签名
set -o pipefail
export GIT_CONFIG_COUNT=2 GIT_CONFIG_KEY_0=http.proxy GIT_CONFIG_VALUE_0= GIT_CONFIG_KEY_1=https.proxy GIT_CONFIG_VALUE_1=
DEVICE="${1:?device udid}"
cd "$(dirname "$0")/../App"
xcodebuild -project App.xcodeproj -scheme App -configuration Debug \
  -destination "id=$DEVICE" -derivedDataPath build -scmProvider system \
  -allowProvisioningUpdates -allowProvisioningDeviceRegistration \
  -xcconfig local.xcconfig build > /tmp/xcb-dev.log 2>&1
echo "build exit $?"
grep -E "BUILD (SUCCEEDED|FAILED)|error:" /tmp/xcb-dev.log | sort -u | cut -c1-250 | head -8
APP=build/Build/Products/Debug-iphoneos/App.app
[ -d "$APP" ] || exit 1
xcrun devicectl device install app --device "$DEVICE" "$APP" 2>&1 | tail -3
xcrun devicectl device process launch --device "$DEVICE" dev.folia.ios 2>&1 | tail -3
