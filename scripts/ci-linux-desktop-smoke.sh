#!/usr/bin/env bash
# Isolated CI runner only. Never execute on the production VPS.
set -euo pipefail
[[ "${CI:-}" == "true" ]] || { echo "CI-only Linux package smoke test" >&2; exit 2; }
shopt -s nullglob
debs=(release/*.deb)
images=(release/*.AppImage)
[[ ${#debs[@]} -eq 1 && ${#images[@]} -eq 1 ]] || { echo "Expected exactly one DEB and one AppImage" >&2; exit 1; }
dpkg-deb --info "${debs[0]}" >/dev/null
pkg=$(dpkg-deb -f "${debs[0]}" Package)
[[ "$pkg" == "faxingpro" ]] || { echo "Unexpected package: $pkg" >&2; exit 1; }
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
dpkg-deb -x "${debs[0]}" "$tmp/deb"
test -x "$tmp/deb/opt/FaxingPro/faxingpro"
chmod +x "${images[0]}"
(cd "$tmp" && "$OLDPWD/${images[0]}" --appimage-extract >/dev/null)
test -x "$tmp/squashfs-root/AppRun"
# The test runner is disposable. apt install/remove must never run on the VPS.
sudo apt-get update -qq
sudo apt-get install -y -qq xvfb "./${debs[0]}"
command -v faxingpro
# Fail closed on the actual installed package: Chromium requires its setuid
# sandbox helper to be owned by root with mode 4755. Never bypass the sandbox.
sandbox=/opt/FaxingPro/chrome-sandbox
if [[ ! -f "$sandbox" ]]; then
  echo "ERROR: installed Electron chrome-sandbox helper is missing" >&2
  exit 1
fi
sandbox_owner=$(stat -c '%u:%g' "$sandbox")
sandbox_mode=$(stat -c '%a' "$sandbox")
if [[ "$sandbox_owner" != "0:0" || "$sandbox_mode" != "4755" ]]; then
  echo "ERROR: unsafe chrome-sandbox metadata: owner=$sandbox_owner mode=$sandbox_mode (required 0:0 / 4755)" >&2
  echo "Fix the DEB packaging/install metadata; do not use --no-sandbox or skip GUI validation." >&2
  exit 1
fi
set +e
timeout 20s xvfb-run -a faxingpro >"$tmp/launch.log" 2>&1
rc=$?
set -e
# A timed-out GUI means the process stayed alive; immediate nonzero exits fail.
if [[ "$rc" -ne 124 ]]; then
  echo "Desktop launch exited unexpectedly (code $rc)" >&2
  sed -n '1,80p' "$tmp/launch.log" >&2
  exit 1
fi
sudo apt-get remove -y -qq faxingpro
if dpkg-query -W -f='${db:Status-Abbrev}' faxingpro 2>/dev/null | grep -q '^ii'; then
  echo "FaxingPro still installed after removal" >&2
  exit 1
fi
echo "PASS: DEB install/GUI startup/remove and AppImage extraction (isolated CI only)"
