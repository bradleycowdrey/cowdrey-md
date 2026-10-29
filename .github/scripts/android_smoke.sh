#!/usr/bin/env bash
# Smoke test on an Android emulator: install the APK, launch it, agree to the Terms, open the editor,
# press Back, switch to dark mode, and keep a screenshot of each step plus the app's log.
# Usage: android_smoke.sh <apk> <output dir>
set -u
APK="$1"; OUT="$2"; PKG=com.bradcowdrey.cowdreymd
mkdir -p "$OUT"
shot() { adb exec-out screencap -p > "$OUT/$1.png"; echo "screenshot $1"; }
# Tap the on-screen element whose text or description matches (the web view exposes its buttons to accessibility).
tap() {
  adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb pull /sdcard/ui.xml "$OUT/ui.xml" >/dev/null 2>&1
  local b
  b=$(grep -oE "(text|content-desc)=\"$1\"[^>]*bounds=\"\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]\"" "$OUT/ui.xml" | head -1 | grep -oE '\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]')
  if [[ -z "$b" ]]; then echo "could not find \"$1\" on screen"; return 1; fi
  read -r x1 y1 x2 y2 <<<"$(echo "$b" | tr -c '0-9' ' ')"
  adb shell input tap $(((x1 + x2) / 2)) $(((y1 + y2) / 2)); echo "tapped \"$1\""; sleep 3
}
# The emulator's own launcher sometimes stalls on CI and covers the app with "isn't responding": hide those
# system dialogs, and tap "Wait" if one still shows.
adb shell settings put global hide_error_dialogs 1 2>/dev/null
dismiss() { tap "Wait" >/dev/null 2>&1 && echo "dismissed a system dialog"; return 0; }
adb install -r "$APK" && echo "installed"
adb shell dumpsys package "$PKG" | grep -m1 versionName | sed 's/^ */installed version: /'
adb logcat -c
adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null && echo "launched"
sleep 25
dismiss
shot 1-first-launch
tap "I agree"
dismiss
shot 2-reading-view
tap "Edit"
sleep 2
shot 3-editing
adb shell input keyevent KEYCODE_BACK; sleep 2   # hides the keyboard
adb shell input keyevent KEYCODE_BACK; sleep 3   # leaves editing
shot 4-after-back
adb shell cmd uimode night yes; sleep 5
shot 5-dark
adb shell cmd uimode night no
if adb shell pidof "$PKG" >/dev/null; then echo "app still running: yes"; else echo "app still running: NO (it closed or crashed)"; fi
adb logcat -d > "$OUT/logcat-full.txt"
grep -iE "chromium|console|tauri|cowdrey|AndroidRuntime|FATAL|RustStdoutStderr" "$OUT/logcat-full.txt" | tail -300 > "$OUT/logcat.txt"
rm -f "$OUT/logcat-full.txt"
exit 0
