#!/bin/sh
# Installs the Ordem desktop app from the latest GitHub release.
#
#   curl -fsSL https://raw.githubusercontent.com/izaiasneto4/ordem/main/install.sh | sh
#
# macOS: Ordem.app in /Applications (or ~/Applications). Files fetched with curl
# carry no quarantine flag, so the unsigned app opens without Gatekeeper's prompt.
# Linux: the AppImage in ~/Applications plus a launcher entry; it updates itself.
# Every download is checked against the release's SHA256SUMS before installing.
#
# Settings:
#   ORDEM_VERSION=1.0.0       install that version instead of the newest release
#   ORDEM_INSTALL_DIR=<dir>   where the app goes
#   ORDEM_DOWNLOAD_URL=<url>  release files base URL (tests serve them locally)
set -eu

REPO="izaiasneto4/ordem"
DOWNLOAD_URL="${ORDEM_DOWNLOAD_URL:-https://github.com/$REPO/releases/download}"

say() { printf '%s\n' "$*"; }
fail() { printf 'ordem install: %s\n' "$*" >&2; exit 1; }

need() {
  command -v "$1" >/dev/null 2>&1 || fail "needs $1, which is not installed"
}

need curl
need uname

case "$(uname -s)" in
  Darwin) os=mac ;;
  Linux) os=linux ;;
  *) fail "this script supports macOS and Linux. On Windows, download the installer from https://github.com/$REPO/releases" ;;
esac

case "$(uname -m)" in
  arm64 | aarch64) arch=arm64 ;;
  x86_64 | amd64) arch=x64 ;;
  *) fail "unsupported processor $(uname -m)" ;;
esac

# Newest release, pre-releases included, unless ORDEM_VERSION pins one.
if [ -n "${ORDEM_VERSION:-}" ]; then
  version="${ORDEM_VERSION#v}"
else
  version=$(curl -fsSL "https://api.github.com/repos/$REPO/releases?per_page=1" |
    grep -m 1 '"tag_name"' | sed -E 's/.*"tag_name"[^"]*"v?([^"]+)".*/\1/')
  [ -n "$version" ] || fail "could not find a release on https://github.com/$REPO/releases"
fi
tag="v$version"

if [ "$os" = mac ]; then
  file="Ordem-$version-$arch.zip"
elif [ "$arch" = arm64 ]; then
  file="Ordem-$version-arm64.AppImage"
else
  file="Ordem-$version-x86_64.AppImage"
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

say "Downloading Ordem $version for $os ($arch)…"
curl -fL --progress-bar -o "$work/$file" "$DOWNLOAD_URL/$tag/$file" || fail "download failed: $DOWNLOAD_URL/$tag/$file"
curl -fsSL -o "$work/SHA256SUMS" "$DOWNLOAD_URL/$tag/SHA256SUMS" || fail "release $tag has no SHA256SUMS to check the download against"

expected=$(awk -v name="$file" '$2 == name || $2 == "*" name { print $1 }' "$work/SHA256SUMS")
[ -n "$expected" ] || fail "SHA256SUMS does not list $file"
if command -v sha256sum >/dev/null 2>&1; then
  actual=$(sha256sum "$work/$file" | awk '{ print $1 }')
else
  actual=$(shasum -a 256 "$work/$file" | awk '{ print $1 }')
fi
[ "$expected" = "$actual" ] || fail "checksum mismatch for $file; not installing"

install_mac() {
  need ditto
  if [ -n "${ORDEM_INSTALL_DIR:-}" ]; then
    target_dir="$ORDEM_INSTALL_DIR"
  elif [ -w /Applications ]; then
    target_dir=/Applications
  else
    target_dir="$HOME/Applications"
  fi
  mkdir -p "$target_dir"
  app="$target_dir/Ordem.app"

  # Replacing a running app breaks it; ask it to quit (it stops its server first).
  if pgrep -x Ordem >/dev/null 2>&1; then
    say "Quitting the running Ordem…"
    osascript -e 'quit app "Ordem"' >/dev/null 2>&1 || true
    tries=0
    while pgrep -x Ordem >/dev/null 2>&1 && [ "$tries" -lt 20 ]; do
      sleep 0.5
      tries=$((tries + 1))
    done
    pgrep -x Ordem >/dev/null 2>&1 && fail "quit Ordem, then run this again"
  fi

  ditto -x -k "$work/$file" "$work/unpacked"
  [ -d "$work/unpacked/Ordem.app" ] || fail "the download did not contain Ordem.app"
  rm -rf "$app"
  ditto "$work/unpacked/Ordem.app" "$app"
  # A copy that came through a browser before would still carry the flag.
  xattr -dr com.apple.quarantine "$app" 2>/dev/null || true

  say "Installed $app"
  say "Open it from Launchpad or with: open \"$app\""
  say "This build is not signed with an Apple Developer ID, so it does not update itself. Run this script again to upgrade."
}

install_linux() {
  target_dir="${ORDEM_INSTALL_DIR:-$HOME/Applications}"
  mkdir -p "$target_dir"
  appimage="$target_dir/Ordem.AppImage"
  # Same path every time: the in-app updater replaces this file in place.
  mv "$work/$file" "$appimage"
  chmod +x "$appimage"

  data_home="${XDG_DATA_HOME:-$HOME/.local/share}"
  icon="$data_home/icons/hicolor/512x512/apps/ordem.png"
  mkdir -p "$(dirname "$icon")" "$data_home/applications"
  curl -fsSL -o "$icon" "https://raw.githubusercontent.com/$REPO/$tag/public/icon.png" 2>/dev/null || true
  cat >"$data_home/applications/ordem.desktop" <<EOF
[Desktop Entry]
Name=Ordem
Comment=Automated GitHub pull request reviews
Exec="$appimage" %U
Icon=ordem
Terminal=false
Type=Application
Categories=Development;
StartupWMClass=Ordem
EOF
  command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$data_home/applications" >/dev/null 2>&1 || true

  say "Installed $appimage"
  say "Start Ordem from your app launcher, or run: \"$appimage\""
  say "It updates itself when a new release is out."
}

if [ "$os" = mac ]; then install_mac; else install_linux; fi

# Ordem drives these; it starts without them but cannot sync or review.
missing=""
for tool in git gh; do
  command -v "$tool" >/dev/null 2>&1 || missing="$missing $tool"
done
if ! command -v claude >/dev/null 2>&1 && ! command -v codex >/dev/null 2>&1 && ! command -v opencode >/dev/null 2>&1; then
  missing="$missing claude|codex|opencode"
fi
if [ -n "$missing" ]; then
  say ""
  say "Ordem also needs:$missing"
  say "See https://github.com/$REPO#supported-environment"
fi
