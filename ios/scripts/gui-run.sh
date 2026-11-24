#!/bin/bash
# 把一条命令放进当前用户的 GUI（Aqua）会话里跑并等它结束：SSH 会话里登录钥匙串是锁的，GUI 会话里不是
LABEL=dev.folia.gui-run
OUT=/tmp/$LABEL.log; DONE=/tmp/$LABEL.done
rm -f "$OUT" "$DONE"
PL=/tmp/$LABEL.plist
CMD=$(printf '%q ' "$@")
cat > $PL <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>-c</string><string>$CMD; echo \$? > $DONE</string></array>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$OUT</string>
  <key>StandardErrorPath</key><string>$OUT</string>
</dict></plist>
PLIST
launchctl bootout gui/$(id -u)/$LABEL 2>/dev/null
launchctl bootstrap gui/$(id -u) $PL || exit 1
while [ ! -f $DONE ]; do sleep 2; done
launchctl bootout gui/$(id -u)/$LABEL 2>/dev/null
cat $OUT
exit $(cat $DONE)
