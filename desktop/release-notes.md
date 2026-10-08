## Download

| System | File |
|---|---|
| macOS, Apple Silicon (M1 and later) | `Ordem-<version>-arm64.dmg` |
| macOS, Intel | `Ordem-<version>-x64.dmg` |
| Linux, any distribution | `Ordem-<version>-x86_64.AppImage` (or `-arm64.AppImage`) |
| Debian, Ubuntu | `Ordem-<version>-amd64.deb` (or `-arm64.deb`) |
| Windows | `Ordem-Setup-<version>-x64.exe` |

Ordem drives the CLIs you already use, so you need [Git](https://git-scm.com/downloads), [GitHub CLI](https://cli.github.com/) (`gh auth login`) and at least one of `claude`, `codex` or `opencode` installed. The app finds them through your login shell.

**macOS:** open the DMG and drag Ordem to Applications. This build isn't signed with an Apple Developer ID yet, so the first launch is blocked. Open **System Settings → Privacy & Security** and click **Open Anyway**, or run `xattr -dr com.apple.quarantine /Applications/Ordem.app` once. Unsigned macOS builds don't update themselves; download new versions from this page.

**Linux:** for the AppImage, run `chmod +x Ordem-*.AppImage` and open it. For the deb, run `sudo apt install ./Ordem-*.deb`, then start Ordem from your launcher. Both update themselves.

**Windows:** run the installer. SmartScreen may warn about an unknown publisher: click **More info → Run anyway**. The app updates itself.

Your data lives in `~/.ordem/userdata`, so it survives reinstalls and updates.
