# Ordem desktop port: work plan

Companion to `desktop-port-spec.md`. The spec says what and why; this says in which order, in
which PRs, with which tests, and when we know each step is done. Every PR keeps `bin/dev`, the
Docker image and `bun run --cwd backend test` green. Desktop is additive until the last milestone.

## Assumptions (change these and the plan changes)

| Topic | Assumed | Effect if wrong |
|---|---|---|
| App id | `dev.ordem.app` placeholder, product name `Ordem` | one constant in `desktop/electron-builder.config.ts` |
| Apple Developer account | not available yet | M1 ships an unsigned DMG; M3 (signing, auto-update on macOS) waits on it |
| Windows arm64 | skipped | add a matrix entry later, x64 binary under emulation |
| Electron | current stable (T3 Code is on 44) | none |
| Bun | 1.2.20 from `.tool-versions`; compile verified on it | re-verify the probe if bumped |
| Version source | root `package.json` version drives the app and the sidecar | small script to copy it into `desktop/package.json` at build |
| Where state lives | `~/.ordem/userdata` in the app, `~/.ordem/dev` in development, `storage/` unchanged for web and Docker | config defaults in A1 |

## Milestones

| Milestone | Means | PRs |
|---|---|---|
| M0 Backend can live outside the repo | the compiled Bun binary boots from `/tmp` with env vars only; API protected by a token; CORS for the custom scheme | A1 A2 A3 A4 |
| M1 macOS alpha DMG | `bun run dist:mac` produces a DMG; sync, review, logs work with no terminal open | B1 B2 C1 C2 C3 C4 |
| M2 Three platforms from CI | AppImage, deb, NSIS, DMG built by one workflow, each smoke-tested on its own OS | C5 C6 C7 |
| M3 Signed and self-updating | notarized macOS build; a tagged release updates a previous install on macOS and Linux | C8 B3 |
| M4 Polish | dock badge, notifications, CLI shim, starting screen, nightly channel | C9 |

## Status

Tick a box when the PR is merged. The next unchecked item whose dependencies are ticked is the
next thing to do. Implemented together on 2026-10-08 (see "Implementation notes" in the spec);
C8 is code-complete but its done check needs an Apple Developer account and a published release.

- [x] A1 Config: home dir, mode, host, resource dirs
- [x] A2 Sidecar build script and CI boot test (needs A1)
- [x] A3 Desktop token auth (needs A1)
- [x] A4 Desktop origins and CORS (needs A1)
- [x] B1 Bridge contract and base URL indirection
- [x] B2 Folder picker through the bridge, platform chrome (needs B1)
- [x] C1 Scaffold `desktop/` and a dev launcher
- [x] C2 Backend supervisor, paths, shell env (needs A1, C1)
- [x] C3 Custom protocol, preload bridge, IPC, window (needs A3, A4, B1, B2, C2)
- [x] C4 electron-builder config and macOS DMG (needs A2, C3). Milestone M1
- [x] C5 Linux (needs C4)
- [x] C6 Windows (needs C4)
- [x] C7 Release workflow (needs C5, C6). Milestone M2
- [ ] C8 Signing, notarization, auto-update (needs C7, Apple account). Milestone M3. Linux auto-update verified in CI (`linux-update` job: a 0.0.1 AppImage updates itself to 0.0.2 from a local feed). macOS signing, notarization and updates wait on the Apple Developer account
- [x] B3 Updates panel in Settings (needs C8)
- [x] C9 Polish (needs C8)

Three tracks run in parallel from day one: A (backend), B (frontend), C (shell). The critical
path is A1 -> C2 -> C3 -> C4.

```
A1 config paths ──┬─> A2 sidecar build + CI boot test
                  ├─> A3 token auth ──┐
                  └─> A4 CORS/origins ─┤
B1 bridge + base URL ─────────────────┼─> C3 protocol + preload ─> C4 mac DMG (M1)
C1 scaffold ─> C2 supervisor ─────────┘                              │
B2 picker + chrome ───────────────────────────────────────────────────┘
C4 ─> C5 linux ─┬─> C7 release workflow (M2) ─> C8 signing + updater (M3) ─> C9
      C6 windows┘                                 B3 updates UI
```

Sizes: S under a day, M one to three days, L three to five days.

## Track A: backend prerequisites

### A1 Config: home dir, mode, host, resource dirs (M)

Goal: the server can run from a read-only bundle with its state somewhere stable.

Files: `backend/src/config.ts`, `backend/src/db/migrate.ts`, `backend/src/server.ts`,
`backend/src/index.ts`, `backend/bin/migrate.ts`, `backend/src/scripts/script-context.ts`,
`.env.example`, `README.md` (Configuration section).

Change:
- `RuntimeConfig` gains `mode: 'server' | 'desktop'`, `host`, `stateDir`, `migrationsDir`.
  New env: `ORDEM_MODE`, `ORDEM_HOME`, `ORDEM_HOST`, `ORDEM_PUBLIC_DIR`, `ORDEM_MIGRATIONS_DIR`.
- Resolution order for the database: `DATABASE_PATH` if set; else `$ORDEM_HOME/<userdata|dev>/ordem.sqlite3`
  when `ORDEM_HOME` is set; else today's `storage/<env>.sqlite3`. `dev` when
  `NODE_ENV !== 'production'`, same split as T3 Code.
- `migrateDatabase(db, migrationsDir)` takes the folder; the `import.meta.url` default moves into
  `config.ts` so the compiled binary never computes it.
- `startServer` listens on `config.host` (default `0.0.0.0`, desktop passes `127.0.0.1`).
- `index.ts` runs `process.chdir(config.appRoot)` only when `mode === 'server'`.
- `ORDEM_HOME` creates the state dir on boot (`mkdirSync recursive`).

Tests: extend `backend/test/config.test.ts` (home dir split, host, migrations dir, precedence),
`backend/test/db/migrate.test.ts` (explicit folder), `backend/test/server.test.ts` (binds the
configured host). Existing default tests must not change.

Verify: `bun run --cwd backend test && bun run --cwd backend typecheck`, then
`ORDEM_HOME=/tmp/ordem-home bun backend/src/index.ts` and check the sqlite file lands in
`/tmp/ordem-home/dev/`.

Done when: defaults unchanged, new vars covered by tests, README lists them.

The `ORDEM_MIGRATIONS_DIR` override is the one line the spike patched to make the compiled binary
boot; see the spec appendix for the evidence. Full variable table: spec section 2.14.

### A2 Sidecar build script and CI boot test (S)

Goal: a compiled server binary per target, and a CI job that proves it boots outside the repo.

Files: `scripts/build-server.ts` (new, Bun), root `package.json` scripts, `.github/workflows/ci.yml`.

Change:
- `scripts/build-server.ts [--target <bun-target>|--all]`: runs
  `bun build --compile --target=<t> backend/src/index.ts --outfile desktop/prod-resources/server/<platform>-<arch>/ordem-server[.exe]`
  with `--windows-hide-console` on Windows targets. The folder uses electron-builder's names
  (`darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`, `win32-x64`); the Bun target to folder
  table lives in spec 2.7 and this script is its only owner.
- `desktop/prod-resources/` gitignored.
- CI job `sidecar` (ubuntu): compile host target, copy `backend/drizzle` to a temp dir, run the
  binary from `/tmp` with `ORDEM_HOME`, `ORDEM_MIGRATIONS_DIR`, `ORDEM_PUBLIC_DIR`,
  `PORT=3977`, `ORDEM_DISABLE_JOB_WORKER=1`; curl `/up` and `/api/v1/status`; kill by PID.
  Fail on any non-200.

Verify: the CI job, and locally `bun scripts/build-server.ts --target bun-darwin-arm64`.

Done when: CI green with the compiled binary serving both endpoints. This is the regression test
for the `import.meta.url` crash from the spec's appendix.

### A3 Desktop token auth (S)

Goal: when a token is configured, only the holder can use the API and the WebSocket.

Files: `backend/src/http/desktop-auth.ts` (new), `backend/src/config.ts` (`desktopToken`),
`backend/src/app.ts`, `backend/src/cli/client.ts`, `backend/test/http/desktop-auth.test.ts` (new),
`backend/test/support/app.ts` (option to pass a token).

Change:
- `ORDEM_DESKTOP_TOKEN` -> `config.desktopToken` (optional).
- Plugin in `app.ts` after the host check: for `/api/*` require
  `Authorization: Bearer <token>`; for the `/ws` handshake require `?token=<token>`; `/up` and
  static files stay open. Wrong or missing token: 401 with the standard error envelope
  (`ERROR_CODES.unauthorized`, new).
- Compare with `crypto.timingSafeEqual` on equal-length buffers.
- `bin/ordem` CLI sends `Authorization` from `ORDEM_API_TOKEN` when set, so it can talk to a
  desktop-hosted server later.

Tests: 401 without token, 200 with, `/up` open, ws upgrade rejected without query token,
accepted with. CLI client test: header present when env set.

Done when: token absent means behaviour identical to today (covered by the existing route suite).

### A4 Desktop origins and CORS (S)

Goal: a renderer on `ordem://app` can fetch and open sockets against `127.0.0.1:<port>`.

Files: `backend/src/http/host-authorization.ts`, `backend/src/http/cors.ts` (new),
`backend/src/app.ts`, `backend/test/http/host-authorization.test.ts`,
`backend/test/http/cors.test.ts` (new).

Change:
- `DESKTOP_RENDERER_ORIGINS = ['ordem://app', 'ordem-dev://app']` in one place.
- `websocketOriginAllowed` accepts them.
- CORS plugin for `/api/*`: when the request `Origin` is one of them, answer
  `Access-Control-Allow-Origin: <origin>`, `Vary: Origin`,
  `Access-Control-Allow-Headers: content-type, authorization`,
  `Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS`; `OPTIONS` returns 204 before
  auth runs. Any other origin gets no CORS headers (browser blocks it, same as today).

Tests: preflight for PATCH from `ordem://app` is 204 with the headers; a `https://evil.example`
origin gets none; ws origin accepted.

Done when: a manual `curl -X OPTIONS -H 'Origin: ordem://app' -H 'Access-Control-Request-Method: PATCH' http://127.0.0.1:3000/api/v1/settings` shows the headers.

## Track B: frontend

### B1 Bridge contract and base URL indirection (S)

Goal: the web app can run from a different origin than the API, with zero change in a browser.

Files: `shared/desktop-bridge.ts` (new, repo root), `frontend/tsconfig.app.json` (paths
`@shared/*`), `frontend/vite.config.ts` (`resolve.alias`), `frontend/vitest.config.ts` (same
alias), `frontend/src/vite-env.d.ts` (`Window.ordemDesktop?`), `frontend/src/lib/desktop.ts` (new),
`frontend/src/lib/api.ts`, `frontend/src/lib/realtime.ts`, tests beside them.

Change:
- `DesktopBridge` interface as in the spec 2.5. Plain TS, no runtime imports, so the preload can
  import the type too.
- `desktop.ts`: `desktopBridge()` returns `window.ordemDesktop` or `undefined`; `apiBase()`;
  `wsUrl()`; `authHeaders()`.
- `api.ts`: `fetch(apiBase() + path, ...)`, bearer header when a bridge exists,
  `credentials: 'omit'` on desktop.
- `realtime.ts`: `realtimeUrl()` uses `wsBaseUrl + '/ws?token='` on desktop; delete the
  `VITE_WS_URL` branch.

Tests: `api.test.ts` with `window.ordemDesktop` stubbed (base prefixed, header set) and without
(unchanged); `realtime.test.ts` for the URL. Declare the fake bridge values as variables and assert
against them.

Done when: `npm --prefix frontend test` and `npm --prefix frontend run build` pass; the built app
behaves identically in `bin/dev`.

### B2 Folder picker through the bridge, platform chrome (S)

Files: `frontend/src/components/SettingsSheet.tsx`, `frontend/src/main.tsx`,
`frontend/src/styles/ordem.css`, `frontend/src/components/SettingsSheet.test.tsx` (new).

Change:
- "Choose…" calls `bridge.pickFolder({ initialPath: folder })` when a bridge exists, else
  `POST /api/v1/settings/pick_folder` as now.
- `main.tsx` sets `document.documentElement.dataset.platform` from the bridge.
- CSS: on `[data-platform="darwin"]` the `.desktop` shell (`Workspace.tsx:185`) gets a top strip
  with `-webkit-app-region: drag` and `padding-left: var(--desktop-window-controls-inset, 0)`;
  buttons inside get `no-drag`.

Tests: SettingsSheet picks through the bridge when present and through the API when absent.

Done when: web unchanged; in C3 the window is draggable and nothing sits under the traffic lights.

### B3 Updates panel in Settings (S, after C8)

Files: `frontend/src/components/SettingsSheet.tsx`, `shared/desktop-bridge.ts` (`DesktopUpdateState`).

Change: an "About" group showing version, update state (idle, checking, available, downloading
with percent, ready, error), "Check now" and "Restart to update". Hidden without a bridge.

## Track C: desktop shell

### C1 Scaffold `desktop/` and a dev launcher (S)

Goal: an Electron window that shows the running web app. The stepping stone, not the final shape.

Files: `desktop/package.json`, `desktop/tsconfig.json`, `desktop/src/main.ts`,
`desktop/src/preload.ts` (empty bridge), `desktop/scripts/build.ts` (bun build of main and preload
to `desktop/dist-electron/`, `--target=node --format=cjs --external electron`), `bin/dev-desktop`,
root `package.json` scripts (`desktop:build`, `desktop:dev`), `.gitignore` (`desktop/dist-electron`,
`desktop/prod-resources`, `desktop/release`).

Change: `main.ts` creates a `BrowserWindow` (`contextIsolation`, `sandbox`, no `nodeIntegration`,
`show: false` until ready) and loads `http://127.0.0.1:3000` when `ORDEM_DEV_BACKEND_URL` is set.
`bin/dev-desktop` starts `bin/dev` plus the shell build in watch mode and Electron.

Done when: `bin/dev-desktop` opens a window showing Ordem against the dev backend.

### C2 Backend supervisor, paths, shell env (M)

Goal: the shell owns the server lifecycle. No terminal, no stray processes after quit.

Files: `desktop/src/paths.ts`, `desktop/src/backend.ts`, `desktop/src/shell-env.ts`,
`desktop/src/log.ts`, `desktop/test/*.test.ts` (bun:test for the pure parts).

Change:
- `paths.ts`: `ORDEM_HOME` (default `~/.ordem`), state dir (`userdata`, or `dev` when
  `!app.isPackaged`), log dir, and resource paths: packaged -> `process.resourcesPath/server`,
  `.../drizzle`, `.../public` (all real files, shipped as extraResources); dev -> repo paths and
  `bun --watch backend/src/index.ts`. A dev launch throws if the state dir ends in `userdata`.
- `shell-env.ts`: on darwin and linux run `$SHELL -ilc 'env'` with a 3 s timeout and
  `launchctl getenv PATH` on darwin; on win32 run PowerShell with the profile; parse `KEY=value`
  lines; merge PATH-like keys over `process.env`. Failure falls back to `process.env` with a log line.
- `backend.ts`: `startBackend()`: free port via `net.createServer().listen(0)`, 32-byte hex token,
  spawn with the env from spec 2.6 (inherited env, shell-env values on top, strip
  `ORDEM_*`, then the desktop values; `NODE_ENV` and `ORDEM_STATE_DIR` follow `app.isPackaged`), pipe stdout and stderr to
  `logs/server.log` (rotate at 5 MB, keep 3), poll `GET /up` every 100 ms up to 20 s, resolve
  `{ httpBaseUrl, wsBaseUrl, token, pid }`. On unexpected exit: restart with backoff
  (1 s, 2 s, 4 s, cap 30 s, give up after 5 and show a dialog). `stopBackend()`: SIGTERM, wait up to
  6 s (the worker drains for 5 s), then SIGKILL. `before-quit` awaits it.
- Single-instance lock; a second launch focuses the existing window.

Tests: env stripping, backoff schedule, log rotation threshold, shell-env line parsing. The spawn
itself is covered by the smoke test in C4.

Done when: launch the dev shell, `ps` shows one `bun`/`ordem-server` child; quit the app, the
child is gone; kill the child by hand, the shell restarts it and the UI recovers.

### C3 Custom protocol, preload bridge, IPC, window (M)

Goal: the final renderer path: `ordem://app`, token from the bridge, OS integration through IPC.

Depends on A3, A4, B1, B2, C2.

Files: `desktop/src/protocol.ts`, `desktop/src/preload.ts`, `desktop/src/ipc.ts`,
`desktop/src/channels.ts`, `desktop/src/window.ts`, `desktop/src/menu.ts`, `desktop/src/main.ts`,
`desktop/test/protocol.test.ts`.

Change:
- `protocol.ts`: `registerSchemesAsPrivileged` for `ordem` and `ordem-dev` before `ready`
  (`standard, secure, supportFetchAPI, corsEnabled, stream, codeCache` for prod). Handler for
  `ordem://app`: map `/frontend/assets/*` and other existing files to `public/`, SPA routes to
  `public/frontend/index.html`, asset-shaped misses to 404; add the CSP from spec 2.11.
  `ordem-dev://app` proxies to `ORDEM_DEV_SERVER_URL` with a short retry.
- `preload.ts`: `contextBridge.exposeInMainWorld('ordemDesktop', ...)` implementing
  `DesktopBridge`; `getLocalEnvironment` uses `ipcRenderer.sendSync` so the first render has the
  URL; on darwin sets `--desktop-window-controls-inset` like T3 Code. Validate IPC results with
  small type guards, no casts.
- `ipc.ts` + `channels.ts`: `pickFolder` (`dialog.showOpenDialog`), `openExternal`
  (`https:` only), `getLocalEnvironment`, `getPlatform`; update channels stubbed until C8.
- `window.ts`: persisted bounds in `state dir/desktop-settings.json`, clamp to a visible display,
  `titleBarStyle: 'hiddenInset'` on darwin with `trafficLightPosition`, `'hidden'` elsewhere,
  `will-navigate` denied, `setWindowOpenHandler` -> `shell.openExternal`.
- `menu.ts`: app menu on darwin (Quit, Edit, View with zoom and reload, Window), devtools in dev.
- `main.ts` order: lock -> scheme privileges -> `whenReady` -> shell env -> backend -> window ->
  `loadURL('ordem://app/')`.

Tests: URL to file mapping, SPA fallback, 404 for `/missing.js`, CSP header present.

Done when: full flow over the custom scheme; preferences survive a restart with a different port;
links open in the OS browser; "Choose…" opens a native dialog.

### C4 electron-builder config and macOS DMG, unsigned (M). Milestone M1.

Files: `desktop/electron-builder.config.ts`, `desktop/resources/icon.icns`, `icon.ico`,
`icons/*.png` (generated from `public/icon.png` with a script in `desktop/scripts/icons.ts`),
`desktop/resources/entitlements.mac.plist`, `scripts/sync-version.ts`, root scripts
`dist:mac`, `desktop/scripts/smoke.ts`.

Change:
- Config per `(platform, arch)` as in spec 2.7: `extraResources` for the sidecar, `drizzle` and the
  repo-root `public/`; `files` for `dist-electron` only, no `.map`.
- `dist:mac` = `bun scripts/sync-version.ts && npm --prefix frontend run build && bun desktop/scripts/build.ts && bun scripts/build-server.ts --target bun-darwin-arm64 && electron-builder --mac --arm64 --publish never`.
- `smoke.ts`: launches the packaged app with `--smoke`, which makes `main.ts` exit 0 once `/up`
  answered and the window emitted `did-finish-load`, else exit 1 after 30 s. Used by CI in C7.

Done when: install the DMG on a clean user account (no shell PATH tweaks), set a repos folder,
sync, run a review, watch logs, quit. `~/.ordem/userdata/ordem.sqlite3` exists.
`xattr -d com.apple.quarantine` is acceptable at this milestone since the build is unsigned.

### C5 Linux: AppImage and deb (M)

Files: `desktop/electron-builder.config.ts`, `desktop/resources/linux/dev.ordem.app.metainfo.xml`,
`desktop/src/shell-env.ts` (verify on bash and zsh and fish), `desktop/src/paths.ts`
(`XDG_CONFIG_HOME` is not used; `~/.ordem` everywhere, same as T3 Code).

Change: `linux.target [AppImage, deb]`, `executableName ordem`, `toolsets.appimage '1.0.3'`,
`deb.depends` from T3 Code's list, `StartupWMClass`. `dist:linux` script.

Verify on Ubuntu 24.04 (VM or CI runner with xvfb for the smoke test). AppImage runs from
`~/Downloads`; `.deb` installs and appears in the launcher.

### C6 Windows: NSIS (M)

Files: `desktop/electron-builder.config.ts`, `desktop/src/backend.ts` (Windows stop path),
`desktop/src/shell-env.ts` (PowerShell probe), `backend/src/index.ts` (`SIGBREAK` -> shutdown).

Change: `win.target [nsis]`, `nsis.differentialPackage true`, `signAndEditExecutable true`.
Stop: `child.kill()` then wait on `exit`; confirm the job worker drains (Bun on Windows ends the
process on `kill()`, so the drain may not run; if so, mark claimed jobs for recovery on next boot,
which `recoverOrphanedInReviewTasks` already handles). Sidecar is `ordem-server.exe` with
`--windows-hide-console`. `osascript` is never reached because the picker goes through the bridge.

Verify on Windows 11 x64: install, `gh` and `claude` on PATH resolved from the PowerShell profile,
review runs, uninstall removes the app and leaves `%USERPROFILE%\.ordem`.

### C7 Release workflow (M). Milestone M2.

Files: `.github/workflows/release-desktop.yml`, `.github/workflows/ci.yml` (reuse the sidecar job).

Change, as in spec 2.9: `bundle` once on ubuntu (frontend build + `dist-electron`, uploaded as
one artifact); matrix `macos-14`, Intel macOS runner, `ubuntu-24.04`, `ubuntu-24.04-arm`,
`windows-2022`; each compiles its own sidecar, boots it from `/tmp`, runs electron-builder with
`--publish never`, runs `desktop/scripts/smoke.ts` (xvfb on Linux), uploads; `publish` creates one
GitHub Release (pre-release when the tag has a suffix) with every artifact and the `latest*.yml`
files. Trigger: tag `v*` or manual dispatch.

Done when: pushing `v0.1.0-alpha.1` yields a pre-release with DMG x2, zip x2, AppImage x2, deb x2,
NSIS exe, manifests, blockmaps.

### C8 Signing, notarization, auto-update (M). Milestone M3.

Depends on an Apple Developer account.

Files: `desktop/electron-builder.config.ts` (`mac.hardenedRuntime`, entitlements, `notarize`),
`desktop/scripts/after-sign.ts` (assert the sidecar carries a signature; sign it if
electron-builder skipped it), `desktop/src/updater.ts`, `desktop/src/ipc.ts` (update channels),
workflow secrets `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_API_KEY`, `APPLE_API_KEY_ID`,
`APPLE_API_ISSUER`.

Change: `electron-updater` GitHub provider, check 15 s after launch and every 4 minutes, push
state over IPC, `installUpdate` stops the backend (C2) then `quitAndInstall()`. Bun's JIT needs
`com.apple.security.cs.allow-jit`, `allow-unsigned-executable-memory` and
`disable-executable-page-protection` in the entitlements, and the notarized bundle must still
launch the sidecar; test that first, it is the one platform-specific unknown left.

Done when: install `v0.1.0`, publish `v0.1.1`, the running app offers and applies it on macOS
and on a Linux AppImage.

### C9 Polish (per item, S each)

Dock badge with the pending review count (`app.setBadgeCount`, fed by the existing
`review_notifications` channel through the bridge); native notification when a review finishes;
"Install `ordem` command" that writes a shim pointing at the sidecar with `ORDEM_API_TOKEN` and
the port read from a file the shell writes to the state dir; a "server starting" screen driven by
a `backend-state` IPC event; nightly channel in the workflow.

## Conventions for every PR

- Strict TS everywhere, including `desktop/`: no `any`, no `as`, no `!`. IPC payloads cross a
  trust boundary; narrow them with guards.
- Tests assert against declared variables; no network, no real `gh`, `claude` or Electron in unit
  tests. Electron coverage comes from the packaged smoke test only.
- One PR per item above. Subject line short and imperative ("Add desktop token auth"). PR body:
  purpose, test commands run, screenshots for anything visible.
- `public/frontend` stays committed for the web mode; desktop builds always rebuild it.
- Never commit `desktop/prod-resources`, `desktop/release`, `desktop/dist-electron`.

## Risks and what to do about them

| Risk | Mitigation |
|---|---|
| Something else in the backend reads a path from `import.meta` or the cwd | A2's CI boot test runs from `/tmp`; grep for `import.meta.url`, `import.meta.dir`, `process.cwd()` as part of A1 (today: only `migrate.ts` and `config.ts`) |
| Hardened runtime blocks the Bun sidecar on macOS | C8 starts with a signed, notarized local build that only launches the sidecar; entitlements listed above |
| GUI PATH lacks `gh` or `claude` | C2's shell-env probe, plus a Settings warning listing which CLIs were not found (`/api/v1/status` already reports them) |
| Windows kill skips the job drain | C6 verifies; orphan recovery already exists on the backend |
| Sidecar size (60 to 120 MB) makes updates slow | blockmaps (`differentialPackage`) on Windows and the zip target on macOS keep deltas small; accept for Linux |
| Electron main on `bun build` output misbehaves | fall back to `tsc` for `desktop/` (CJS, ES2022); nothing in the shell needs bundling |
| Port in use or `/up` never answers | 20 s timeout, dialog with the log path, "Retry" and "Quit" |

## First week, concretely

1. A1 (config) and C1 (scaffold) in parallel. C1 can point at `bin/dev`'s backend the whole week.
2. A2 right after A1 lands; this is the cheapest insurance in the plan.
3. B1 while A3 and A4 are in review.
4. C2 against the dev backend; by the end of the week the shell starts and stops its own server.
5. C3 and C4 the following week; M1 is realistic within two to three weeks of part-time work.
