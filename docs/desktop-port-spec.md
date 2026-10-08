# Ordem desktop port

Spec for shipping Ordem as a macOS, Linux and Windows app, built the way T3 Code
(https://github.com/pingdotgg/t3code) builds its desktop app. Part 1 is what T3 Code does and
why. Part 2 is how to apply it here. Implemented on 2026-10-08; where the code departs from
this text, "Implementation notes" at the end says how and why.

T3 Code snapshot studied: `main` on 2026-10-08 (desktop 0.0.45, Electron 44, electron-builder 26).

How to use: this file is the reference (what and why). `desktop-port-plan.md` is the execution
order (PR by PR, with files, tests and done checks). An agent implementing the port works from the
plan and comes back here for interfaces, config semantics and packaging details. Repo conventions
in `AGENTS.md` apply to every PR: strict TypeScript, no `any`, no `as`, no `!`, tests through
`createTestContext()` and `createTestApp`, assertions against declared variables.

## Part 1: how T3 Code works under the hood

### 1.1 One server, several dumb clients

T3 Code is a Node server that wraps the agent CLIs and talks to clients over WebSocket RPC and
HTTP. The web app (`apps/web`), the Electron app (`apps/desktop`) and the mobile app are all
clients of that server. The desktop app is not a different program. It is the same web bundle in a
Chromium window, plus an Electron main process whose main job is to start, watch and stop a copy of
the server on your machine.

Their architecture doc says it plainly: "T3 Code keeps execution in the environment that owns the
workspace ... The desktop app bundles a server, but its renderer follows the same boundary."
Provider processes, git, the filesystem and SQLite belong to the server. The renderer never touches
them, even when they live on the same laptop.

That one rule is what makes multi-platform cheap. Packaging becomes "put the server next to the
web bundle and start it".

### 1.2 Repo layout

| Path | What it is |
|---|---|
| `apps/server` | Node server. Also the `t3` CLI (`src/bin.ts`). Serves the built web client from `dist/client`. |
| `apps/web` | Vite + React. One bundle, used by browser and desktop. |
| `apps/desktop` | Electron main + preload. About 90 source files, no UI of its own. |
| `packages/contracts` | Wire types. Includes the `DesktopBridge` interface the preload exposes (`src/ipc.ts`). |
| `packages/client-runtime` | Connection and state logic shared by web and mobile. |
| `scripts/build-desktop-artifact.ts` | The entire electron-builder config, as code. 146 KB. |
| `scripts/lib/cli-external-packages.ts` | The single list of packages that must stay outside the bundle. |
| `.github/workflows/release.yml`, `release-desktop.yml` | Build once, package per platform. |

### 1.3 How the desktop app runs the server

From `apps/desktop/src/backend/DesktopBackendManager.ts` and `DesktopBackendConfiguration.ts`:

- It spawns `process.execPath` (the Electron binary) with `ELECTRON_RUN_AS_NODE=1` and the args
  `--require compileCache.cjs apps/server/dist/bin.mjs --bootstrap-fd 3`. The server runs on
  Electron's embedded Node. No second runtime ships.
- Config is not flags. A JSON "bootstrap envelope" (`mode: desktop`, port, bind host, `t3Home`,
  a per-launch token, telemetry fds) is written to fd 3 and read by the server at startup.
- Env: the child inherits `process.env` (so PATH is right) but every `T3CODE_*` key is deleted
  first, so a developer's shell cannot leak settings into the packaged app.
- Readiness is an HTTP poll of `/.well-known/t3/environment` at a 100 ms cadence with a timeout.
  "Process started" is never treated as "ready".
- Crash loop: restart with backoff. A preflight failure (bad config) stops the loop and shows up in
  the UI instead of looping forever.
- Stop: SIGTERM, force kill after a grace period. Quit waits for it.
- stdout/stderr are piped into a rotating log file per backend under the state dir.
- On Windows the server tree ships as a separate `resources/server.asar` so NSIS copies one big
  file instead of 13,875 small ones. Install time tracks file count, not bytes.

GUI apps on macOS and Linux start with a stripped PATH, so `claude` and `gh` would be missing.
`shell/DesktopShellEnvironment.ts` probes the user's login shell (`$SHELL -ilc env`),
`launchctl getenv PATH` on macOS and the PowerShell profile on Windows, then merges the result into
the backend's env. Without this, "works in the terminal, not in the app" bugs are guaranteed.

### 1.4 How the renderer loads and reaches the server

- Before `app.ready`, Electron registers a privileged custom scheme, `t3code://` (and
  `t3code-dev://` in development): `standard, secure, supportFetchAPI, corsEnabled, stream,
  codeCache`. The main window loads `t3code://app/`.
- In production the protocol handler serves the built client from disk with SPA fallback to
  `index.html` and a Content-Security-Policy header. In development it proxies to Vite, with a
  short retry while Vite restarts.
- The renderer then calls the server at `http://127.0.0.1:<port>` directly, both HTTP and
  WebSocket. The server's CORS allowlist includes `t3code://app` and `t3code-dev://app`
  (`apps/server/src/http.ts`, `DESKTOP_RENDERER_ORIGINS`).
- The per-launch token reaches the renderer through the preload and goes out as a bearer
  credential. It rotates per window. The server stays authoritative; the shell never bypasses it.
- `BrowserWindow`: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`,
  `show: false` until ready-to-show, persisted bounds, `titleBarStyle: "hiddenInset"` on macOS and
  `"hidden"` elsewhere. The preload sets `--desktop-window-controls-inset` so the UI leaves room for
  the traffic lights.
- The preload exposes `window.desktopBridge` via `contextBridge`. Each method is one
  `ipcRenderer.invoke(CHANNEL, ...)`; channel names are constants in `ipc/channels.ts`; the
  interface is typed in `packages/contracts`. The web app detects desktop with
  `window.desktopBridge !== undefined` and nothing else.

### 1.5 Bundling

- Vite+ `pack` (rolldown/tsdown). The server becomes one `dist/bin.mjs`. Policy: inline every JS
  dependency; only packages Node must load from disk stay external (native addons such as
  `node-pty`, and packages that read their own files at runtime such as `playwright-core`).
- That external list lives in one file and feeds both the bundler and the packaging stage, "so a
  package that is external is also the only kind of package the staged production install
  carries". A test scans the emitted bundle for `//#region node_modules/...` markers and fails
  if an external got inlined.
- Electron main is bundled the same way to `dist-electron/main.cjs`. `boot.cjs` turns on the V8
  compile cache, then requires `main.cjs`. Preloads are self-contained because sandboxed preloads
  cannot `require` packages from inside the asar.
- The web `dist` is copied into `apps/server/dist/client` so the CLI serves it; the desktop
  protocol handler points at the same folder.
- Source maps are stripped from the packaged app (the web maps alone were 50 MB).

### 1.6 Packaging (electron-builder 26)

The config is an object built in `scripts/build-desktop-artifact.ts` (`resolveBuildConfig`), not
a yml file, because it depends on platform, arch, channel and which signing secrets exist.

| Platform | Targets | Notes |
|---|---|---|
| macOS | `dmg` + `zip` | zip is what electron-updater consumes. Developer ID signing and notarization via `APPLE_API_KEY`. Hardened runtime entitlements (`allow-jit`, `allow-unsigned-executable-memory`, `disable-library-validation`). DMG background per channel. |
| Linux | `AppImage` + `deb` | Static AppImage runtime pinned (`toolsets.appimage: "1.0.3"`) so it runs on FUSE 3 distros. `.deb` has a `depends` list of Electron's runtime libs, a metainfo.xml and `StartupWMClass`. electron-updater updates the `.deb` through `dpkg`. AUR packages wrap the release (`packaging/aur`). |
| Windows | `nsis` | `differentialPackage: true` (blockmaps). Azure Trusted Signing when secrets exist. `signAndEditExecutable: true` so the icon applies even unsigned. |

Common: `appId com.t3tools.t3code`, `artifactName "T3-Code-${version}-${arch}.${ext}"`, `files`
exclusions (no `.map`, no prebuilds for other platforms), `extraResources` for native helpers,
`publish: github` so the `latest-*.yml` manifests get generated.

Separately, the CLI ships as a Node single executable per platform in a `.tar.gz`, installed by
`curl | sh`. That path has nothing to do with Electron; it is what `t3 service install`
(launchd/systemd) and `t3 update` manage.

### 1.7 Updates

- `electron-updater`, GitHub provider. Release assets include `latest-mac.yml`,
  `latest-linux.yml`, `latest.yml`, `nightly*.yml` and `.blockmap` files.
- Channels: stable, nightly, preview. Preview builds carry no update feed, so nobody gets offered
  one by accident.
- First check 15 s after launch, then every 4 minutes. State is pushed to the renderer over IPC and
  shown in Settings.
- Install is two-phase because installing stops the bundled server: the client asks the server to
  prepare, receives a token, then commits. If the install fails, the shell restarts the old backend
  and replays the failure for that token.

### 1.8 Release pipeline

`release.yml`: `preflight` (resolve commit, version, channel), then `build_bundle` on one Linux
runner (`vp run build:desktop`; uploads `apps/server/dist` and `apps/desktop/dist-electron` as the
`js-bundle` artifact), then six jobs that call the reusable `release-desktop.yml`, each on hardware
of its own architecture: mac arm64, mac x64, linux x64, linux arm64, win x64, win arm64. Each job
only packages the shared bundle plus native helpers, runs a smoke test and uploads. One `publish`
job creates a single GitHub Release with everything. npm, AUR, Homebrew cask and the hosted web app
follow from that.

Stable is cut by promoting the last green nightly, not by building `main` HEAD.

### 1.9 Dev loop

`vp run dev:desktop` runs Vite, the server from source, `vp pack --watch` for Electron main, and
`scripts/dev-electron.mjs`, which waits for the dist files and the Vite port, launches Electron with
`VITE_DEV_SERVER_URL`, and restarts it when `main.cjs`, `preload.cjs` or `bin.mjs` change. Dev
state lives in `~/.t3/dev` (or a worktree-local `.t3`), never in the real `~/.t3/userdata`.

### 1.10 The principles worth copying

1. The server owns the machine. The renderer is a browser tab, even on desktop.
2. One web bundle. Desktop is detected by the presence of a bridge object, nothing else.
3. The bridge is small and typed. Shell features (folder dialog, open external, updates, platform)
   go through it. App features go through the server API.
4. Readiness is an HTTP probe. Restart with backoff. Kill only the PID you spawned.
5. Data lives in a stable home dir (`~/.t3/userdata`) shared by CLI and desktop, with a `dev`
   sibling for development. Never inside the app bundle.
6. Never bake origins into the web bundle. Dev is single-origin through a proxy.
7. One source of truth for "what stays outside the bundle", enforced by a test.
8. Build the JS once, package per platform on native hardware.

## Part 2: applying this to Ordem

### 2.1 Ordem today

Bun + Elysia API in `backend/`, React + Vite in `frontend/`, built into `public/frontend` and
served by the API. The frontend calls `/api/v1/...` with relative URLs and opens
`ws://<location.host>/ws`. The API binds `0.0.0.0:3000`, runs `process.chdir(appRoot)`, keeps
SQLite in `storage/` under the repo, picks folders with `osascript`, and has no auth (a Host
allowlist and a WebSocket Origin check only). `bin/ordem` is a CLI over the same HTTP API.

| T3 Code | Ordem | Status |
|---|---|---|
| `apps/server` (Node) | `backend/` (Bun) | exists, Bun-only |
| `apps/web` | `frontend/` | exists |
| `apps/desktop` | none | new |
| `packages/contracts` | `backend/src/contracts`, `frontend/src/types` | partial, no bridge type |
| `~/.t3/userdata` | `storage/` inside the repo | must move |
| `t3` CLI | `bin/ordem` | exists |

### 2.2 The one big decision: Bun stays, as a sidecar

T3 Code runs its server on Electron's own Node. Ordem cannot. `bun:sqlite`, `Bun.spawn`,
`Bun.file`, `Bun.sleep` and Elysia's Bun adapter are everywhere, and porting to Node is a rewrite
of the layer that was just finished.

Instead, compile the backend with `bun build --compile` into one executable per platform and ship
it as an Electron `extraResources` sidecar. The Electron main process spawns it the way T3 Code
spawns Node, polls `/up`, and kills it on quit. T3 Code does the same thing for its CLI archive
(a Node single executable), so this is the same principle with a different runtime.

Verified on this repo (appendix): the backend compiles in under a second and cross-compiles for
`bun-darwin-arm64`, `bun-linux-x64` and `bun-windows-x64` from a Mac. One real blocker surfaced:
`backend/src/db/migrate.ts` resolves the migrations folder from `import.meta.url`, which inside
the binary is `/$bunfs/root/...`, so the compiled server crashes on startup with
"Can't find meta/_journal.json". Fix in 2.4.

Costs to accept:

| Sidecar | Size, uncompressed |
|---|---|
| darwin-arm64 | 61 MB |
| linux-x64 | 105 MB |
| windows-x64 | 120 MB |

Plus Electron itself, roughly 200 MB installed. T3 Code's DMG is in the same range. Bun has no
Windows arm64 compile target: ship x64 there (it runs under emulation) or skip it.

Other decisions:

| Question | Decision | Why |
|---|---|---|
| Electron or Tauri | Electron | The ask is "like T3 Code". One Chromium everywhere. electron-updater and electron-builder are proven. Tauri is lighter but every platform gets a different WebView. |
| Load the renderer from `http://127.0.0.1:port` or a custom scheme | Custom scheme `ordem://app` | Stable origin (localStorage survives port changes), the UI can show "starting" before the server is up, CSP, no port in the URL. T3 Code converged on this too. Loading from the port is a fine stepping stone during phase 1. |
| electron-builder or Forge | electron-builder 26 | Same as T3 Code. One tool produces dmg, AppImage, deb, nsis and the update manifests. |
| Keep the web and Docker mode | Yes | Same bundle. Desktop is additive. |

### 2.3 Target architecture

```
+------------------- Ordem.app -------------------+
| Electron main (desktop/src/main.ts)              |
|  +- shell-env: recover login-shell PATH          |
|  +- backend: spawn sidecar, poll /up,            |
|  |    restart with backoff, SIGTERM on quit      |
|  +- protocol: ordem://app -> public/             |
|  +- window, menu, updater, ipc                   |
|  +- preload -> window.ordemDesktop               |
|                                                  |
| Resources/server/ordem-server   (Bun executable) |
| Resources/drizzle/              (migrations)     |
| Resources/public/               (web build)      |
| app.asar: dist-electron/ only                    |
+--------------------------------------------------+
          | spawn + env                 ^ IPC
          v                             |
   ordem-server 127.0.0.1:<port>  <--  renderer at ordem://app
   ORDEM_HOME=~/.ordem                 fetch http://127.0.0.1:<port>/api/v1/...
   ORDEM_DESKTOP_TOKEN=...             ws://127.0.0.1:<port>/ws?token=...
```

Startup: single-instance lock, register `ordem://` privileges, `app.whenReady`, probe shell env,
pick a free port and a random token, spawn the sidecar, poll `/up` (100 ms, 20 s timeout), create
the window, load `ordem://app/`. The renderer reads `{ httpBaseUrl, wsBaseUrl, token, platform }`
from the bridge and runs as it does in a browser.

### 2.4 Backend changes

All small, all useful for the web mode too. Keep today's defaults when the new env vars are absent
so Docker and `bin/dev` keep working.

1. `config.ts`: add `ORDEM_HOME` (default `~/.ordem`), `ORDEM_STATE_DIR` (`$ORDEM_HOME/userdata`,
   or `dev` when `NODE_ENV !== production`), `ORDEM_HOST` (default `0.0.0.0`; desktop passes
   `127.0.0.1`), `ORDEM_PUBLIC_DIR`, `ORDEM_MIGRATIONS_DIR`, `ORDEM_MODE=desktop|server`.
   `DATABASE_PATH` defaults to `$ORDEM_STATE_DIR/ordem.sqlite3` only when `ORDEM_HOME` is set,
   otherwise stays `storage/...`.
2. `db/migrate.ts`: take `migrationsFolder` from config instead of `import.meta.url`. Desktop ships
   `backend/drizzle` as a resource and passes its path. This is the crash from the probe.
3. `index.ts`: skip `process.chdir(appRoot)` in desktop mode. The bundle is read-only and the cwd
   should be the user's home. Settings already store absolute repo paths from the picker.
4. Auth: when `ORDEM_DESKTOP_TOKEN` is set, require `Authorization: Bearer <token>` on `/api/*`
   and `?token=` on the `/ws` upgrade. `/up` stays open since it is the readiness probe. Today any
   local process or web page can drive the API; this closes that for desktop users.
5. Origins: add `ordem://app` and `ordem-dev://app` to `websocketOriginAllowed`, and answer CORS
   for them on `/api/*` (`Access-Control-Allow-Origin: <origin>`, `-Allow-Headers: content-type,
   authorization`, `-Allow-Methods: GET,POST,PATCH,DELETE,OPTIONS`, handle `OPTIONS`). The custom
   scheme is a different origin from `127.0.0.1`, so fetch preflights PATCH and DELETE. T3 Code
   does the same with `DESKTOP_RENDERER_ORIGINS`.
6. Readiness: `/up` already exists and is enough. A `/api/v1/health` with the version can come
   later if the shell needs it.
7. Shutdown: SIGTERM handling exists. On Windows the shell uses `child.kill()`; check the job
   worker's 5 s drain still runs there.
8. Folder picker: keep `pickFolder` (osascript) for web mode. Desktop never calls it.
9. `scripts/build-server.ts`: `bun build --compile --target=bun-<platform>-<arch>
   backend/src/index.ts --outfile desktop/prod-resources/server/<platform>-<arch>/ordem-server`.
   Add a CI step that runs the compiled binary from `/tmp` with only env vars and curls `/up`,
   so the `import.meta.url` class of bug cannot come back.

### 2.5 Frontend changes

1. `shared/desktop-bridge.ts` (new; imported by `frontend` and `desktop` through tsconfig paths):

```ts
export interface DesktopLocalEnvironment { httpBaseUrl: string; wsBaseUrl: string; token: string }
export type DesktopUpdateStatus = 'disabled' | 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error'
export interface DesktopUpdateState {
  status: DesktopUpdateStatus
  currentVersion: string
  availableVersion: string | null
  downloadPercent: number | null
  error: string | null
  checkedAt: string | null
}
export interface DesktopBridge {
  platform: 'darwin' | 'linux' | 'win32'
  getLocalEnvironment(): DesktopLocalEnvironment
  pickFolder(options?: { initialPath?: string }): Promise<string | null>
  openExternal(url: string): Promise<void>
  getUpdateState(): Promise<DesktopUpdateState>
  onUpdateState(listener: (state: DesktopUpdateState) => void): () => void
  checkForUpdates(): Promise<void>
  installUpdate(): Promise<void>
}
declare global { interface Window { ordemDesktop?: DesktopBridge } }
```

2. `lib/desktop.ts`: `isDesktop()`, `apiBase()` (empty string in a browser, `httpBaseUrl` on
   desktop), `wsUrl()`.
3. `lib/api.ts`: `fetch(apiBase() + path)`, bearer header on desktop, `credentials: 'omit'` on
   desktop (cross-origin, and there are no cookies anyway).
4. `lib/realtime.ts`: `realtimeUrl()` returns `wsBaseUrl + '/ws?token=...'` on desktop. Drop the
   `VITE_WS_URL` branch (T3 Code's "never bake origins" rule; nothing in this repo sets it).
5. `SettingsSheet`: pick the folder through the bridge when present, else `POST /pick_folder`.
6. Window chrome: on macOS add a draggable top strip (`-webkit-app-region: drag`) and respect
   `--desktop-window-controls-inset`. The macOS-style design is already there; this is one CSS
   rule plus a `data-platform` attribute on `<html>`.
7. External links: no React change. The shell's `setWindowOpenHandler` sends `target=_blank` to
   the OS browser.
8. Routing and base: keep `base: '/frontend/'` and `BrowserRouter`. The protocol handler maps
   `ordem://app/<spa route>` to `public/frontend/index.html` and `ordem://app/frontend/assets/*`
   to files. `index.html` already references `/icon.svg` at the public root, which the handler
   also serves.
9. A "server starting / server crashed" screen: the shell loads `ordem://app/` only after `/up`
   succeeds, so v1 skips this. Add later with an IPC `backend-state` event.

### 2.6 Desktop shell

New top-level `desktop/` package. Plain TypeScript. T3 Code writes all of this with Effect; that is
their house style, not a requirement. Runtime deps: `electron`, `electron-updater`. Dev deps:
`electron-builder`, `typescript`. Everything else is Node built-ins.

| File | Responsibility | T3 Code counterpart |
|---|---|---|
| `src/main.ts` | boot order, single-instance lock, scheme privileges before ready | `main.ts`, `DesktopPreReadyPlatform` |
| `src/paths.ts` | `ORDEM_HOME`, state dir (`userdata` or `dev`), resource paths for sidecar, drizzle, public; log dir | `DesktopEnvironment`, `DesktopStatePaths` |
| `src/shell-env.ts` | login shell, launchctl and PowerShell PATH probes with a timeout; merged env for the sidecar | `DesktopShellEnvironment` |
| `src/backend.ts` | free port, token, spawn, log piping with rotation, `/up` poll, backoff restart, stop on quit, strip `ORDEM_*` from the inherited env | `DesktopBackendManager`, `DesktopBackendConfiguration` |
| `src/protocol.ts` | `ordem://app` static handler with SPA fallback and CSP; `ordem-dev://app` proxy to Vite | `ElectronProtocol` |
| `src/window.ts` | BrowserWindow options, persisted bounds, ready-to-show, open-external handler, deny navigation | `DesktopWindow`, `ElectronWindow` |
| `src/menu.ts` | macOS app menu, Edit, View, Window; devtools in dev | `ElectronMenu` |
| `src/updater.ts` | electron-updater wiring, IPC state push, quit-and-install after the backend stops | `DesktopUpdates`, `ElectronUpdater` |
| `src/ipc.ts`, `src/channels.ts` | handlers for the bridge methods | `DesktopIpc`, `ipc/channels.ts` |
| `src/preload.ts` | `contextBridge.exposeInMainWorld('ordemDesktop', ...)`, platform, controls inset | `preload.ts` |
| `resources/` | `icon.icns`, `icon.ico`, `icons/*.png`, `entitlements.mac.plist`, `dmg-background.png` | `apps/desktop/resources` |
| `electron-builder.config.ts` | config object per platform and arch (2.7) | `build-desktop-artifact.ts` |

Bundle `main.ts` and `preload.ts` with `bun build --target=node --format=cjs --external electron`
into `dist-electron/`. The preload must import nothing but `electron`.

Spawn:

```ts
// Inherited env first, recovered login-shell values on top (a GUI launch's short PATH must
// lose), then drop every inherited ORDEM_* key, then the desktop values.
const inherited = stripOrdemKeys({ ...process.env, ...shellEnv })
spawn(paths.serverBinary, [], {
  cwd: os.homedir(),
  env: {
    ...inherited,
    ORDEM_MODE: 'desktop',
    ORDEM_HOME: paths.home,
    ORDEM_STATE_DIR: paths.stateDir,   // <home>/userdata when packaged, <home>/dev otherwise
    NODE_ENV: app.isPackaged ? 'production' : 'development',
    ORDEM_HOST: '127.0.0.1',
    PORT: String(port),
    ORDEM_DESKTOP_TOKEN: token,
    ORDEM_PUBLIC_DIR: paths.publicDir,       // Resources/public, real files
    ORDEM_MIGRATIONS_DIR: paths.drizzleDir,  // Resources/drizzle
    ORDEM_LOG_LEVEL: 'info',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
```

A development shell refuses to start when `paths.stateDir` ends in `userdata`, so a dev launch can
never open the real database.

Port: ask the OS for a free one (`net.createServer().listen(0)`), close it, pass it. Token: 32
random bytes, hex. Both are per launch. In development the shell spawns
`bun --watch backend/src/index.ts` instead of the sidecar and points `ORDEM_MIGRATIONS_DIR` at the
repo.

### 2.7 Packaging

`electron-builder.config.ts` returns one config per `(platform, arch)`:

```
appId: <to decide>                       productName: Ordem
artifactName: Ordem-${version}-${arch}.${ext}
files: [dist-electron/**, package.json, "!**/*.map"]     # app.asar holds only Electron main and preload
extraResources:                                          # real files under Resources/; the Bun sidecar cannot read inside app.asar
  - { from: prod-resources/server/${platform}-${arch}, to: server }   # folder names in the table below
  - { from: ../backend/drizzle, to: drizzle }
  - { from: ../public, to: public }                      # repo-root public/, with public/frontend from the Vite build
directories.buildResources: resources
publish: [{ provider: github, owner, repo }]
mac:   target [dmg, zip]; category public.app-category.developer-tools; hardenedRuntime true;
       entitlements with allow-jit, allow-unsigned-executable-memory and
       disable-executable-page-protection (Bun's JIT needs them, see Bun's codesigning notes);
       notarize via APPLE_API_KEY. electron-builder signs the Mach-O files it finds in the bundle;
       confirm the sidecar is covered, else sign it in an afterSign hook.
dmg:   app icon + /Applications link
linux: target [AppImage, deb]; executableName ordem; category Development;
       toolsets.appimage "1.0.3"; deb.depends copied from T3 Code's list
win:   target [nsis]; nsis.differentialPackage true; signAndEditExecutable true; signing optional
```

One target-to-folder mapping, owned by `scripts/build-server.ts` and used verbatim by the
`extraResources` entry above (`${platform}` is electron-builder's name, so Windows is `win32`):

| Bun target | Folder under `desktop/prod-resources/server/` | Binary |
|---|---|---|
| `bun-darwin-arm64` | `darwin-arm64` | `ordem-server` |
| `bun-darwin-x64` | `darwin-x64` | `ordem-server` |
| `bun-linux-x64` | `linux-x64` | `ordem-server` |
| `bun-linux-arm64` | `linux-arm64` | `ordem-server` |
| `bun-windows-x64` | `win32-x64` | `ordem-server.exe` |

Asset layout in the installed app: `Resources/server/ordem-server`, `Resources/drizzle/`,
`Resources/public/` (the protocol handler and `ORDEM_PUBLIC_DIR` both point here), and
`app.asar` with `dist-electron/` only.

Things T3 Code needs that Ordem does not: `asarUnpack` rules (no native addons; the sidecar lives
outside the asar already), the Windows `server.asar` trick (the sidecar is one file), Rust helpers,
and custom protocol handlers for OAuth callbacks (no OAuth here).

Outputs per release: `Ordem-x.y.z-arm64.dmg`, `-x64.dmg`, both `.zip`, `-x64.AppImage`,
`-arm64.AppImage`, two `.deb`, `Ordem Setup x.y.z-x64.exe`, plus `latest-mac.yml`,
`latest-linux.yml`, `latest.yml` and the `.blockmap` files.

### 2.8 Updates

`electron-updater`, GitHub provider, one channel (stable) to start. Check 15 s after launch and
every 4 minutes, same as T3 Code. Install: stop the sidecar (SIGTERM, wait for the job worker's
5 s drain), then `quitAndInstall()`. The sidecar sits inside the bundle, so it updates with the
app. No server-side updater, no launchd service, no two-phase prepare and commit. Those exist in
T3 Code because their server can run on a different machine than the app. Ordem's cannot, so they
are skipped.

Two facts that shape the schedule: Linux `.deb` updates prompt for a password through
electron-updater's dpkg path, and unsigned macOS builds cannot auto-update at all (Squirrel.Mac
refuses). Apple signing is a prerequisite for updates on macOS, not polish.

### 2.9 CI and release

`.github/workflows/release-desktop.yml`, on a `v*` tag or manual dispatch:

1. `bundle` (ubuntu): `npm --prefix frontend ci && npm --prefix frontend run build`, `bun build`
   of `dist-electron`, upload `public/frontend` and `desktop/dist-electron` as one artifact.
   Built once, like T3 Code's `js-bundle`.
2. Matrix, each on its own hardware: `macos-14` (arm64), an Intel macOS runner (`macos-13` today;
   GitHub is retiring it, check the current label), `ubuntu-24.04` (x64), `ubuntu-24.04-arm`
   (arm64), `windows-2022` (x64). Steps: download the bundle, `bun build --compile` for the
   runner's own target (native hardware, T3 Code's rule), smoke test the sidecar (`/up` from
   `/tmp`), `electron-builder --publish never`, smoke test the app (`Ordem --version`, then a
   launch that waits for `/up`), upload artifacts.
3. `publish`: download everything, create one GitHub Release with all files and manifests.
   Pre-release when the tag has a suffix.

Secrets for macOS: `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, `CSC_LINK`,
`CSC_KEY_PASSWORD`. Windows signing can wait. Keep the existing `ci.yml`; add a job that compiles
the sidecar and boots it so the path bug stays fixed.

Nightlies, AUR, Homebrew cask and winget are follow-ups. T3 Code added them after the base
pipeline too.

### 2.10 Dev workflow

`bin/dev` stays for web. New `bin/dev-desktop`: starts `bun --watch backend` with
`ORDEM_HOME=~/.ordem` (state lands in `~/.ordem/dev`), `PORT=3000` and a fixed dev token; starts
Vite on 5173; runs `bun build --watch` for `desktop/src`; launches Electron with
`ORDEM_DEV_SERVER_URL=http://localhost:5173` so `ordem-dev://app` proxies to Vite; restarts
Electron when `dist-electron/*` changes. Rule to keep from T3 Code: no `VITE_*` URLs anywhere.
The renderer learns the backend from the bridge.

### 2.11 Security model

- Sidecar binds `127.0.0.1` only. The Host allowlist already lets IPs through.
- Per-launch bearer token on `/api` and `/ws`. Other local processes and web pages can no longer
  drive the API.
- Origin allowlist for `ordem://app`. CSP on the renderer: `default-src 'self'; connect-src
  http://127.0.0.1:* ws://127.0.0.1:*; img-src 'self' data: https:; style-src 'self'
  'unsafe-inline'`.
- `contextIsolation`, `sandbox`, no `nodeIntegration`. `will-navigate` denied.
  `setWindowOpenHandler` calls `shell.openExternal` after an `https:` check.
- The bridge is the only path from renderer to OS, and it has eight methods.
- Strip `ORDEM_*` from `process.env` before spawning, for the same reason T3 Code strips
  `T3CODE_*`.

### 2.12 Phases

| Phase | Scope | Done when |
|---|---|---|
| 0. Backend prerequisites | 2.4 items 1 to 9, `scripts/build-server.ts`, CI boot test of the compiled binary | the compiled binary runs from `/tmp` with env vars only and serves `/up` and `/api/v1/bootstrap`; web and Docker unchanged |
| 1. Shell MVP, macOS, unsigned | `desktop/` package, sidecar spawn, `ordem://` protocol, window, preload bridge, frontend 2.5 items 1 to 5 | `bun run dist:mac` produces a DMG; sync, review and logs work end to end from the app with no terminal open |
| 2. Linux and Windows | shell-env probe on all three platforms, Windows kill semantics, folder dialog everywhere, AppImage, deb, NSIS, CI matrix | all five artifacts build in CI and pass the smoke test |
| 3. Signing, updates, release | Apple notarization, electron-updater, release workflow, GitHub Release with manifests | a tagged build updates a previous install on macOS and Linux |
| 4. Polish | dock badge for pending reviews, native notification when a review finishes, `ordem` CLI shim install, "server starting" screen, nightly channel | per item |

Phase 0 ships on its own and improves the web app (stable data dir, auth token, origin handling).

### 2.13 Open questions

1. App id and bundle name.
2. Apple Developer account. Without it: no auto-update on macOS and a Gatekeeper warning on first
   launch.
3. Windows arm64: skip, or ship x64.
4. Expose the server on the LAN from the app, like T3 Code's "Network access" toggle? Not needed
   for the stated goal; the backend already supports it through `ORDEM_HOST`.
5. Keep the `osascript` picker in web mode, or require manual path entry on every platform.

### 2.14 Configuration reference

Resolution order for every value: explicit env var, then the desktop default when `ORDEM_HOME` is
set, then today's behaviour. Existing web and Docker installs set none of the new variables and
must see no change.

| Variable | Default (web, Docker) | Desktop shell passes | Used by |
|---|---|---|---|
| `ORDEM_MODE` | `server` | `desktop` | `index.ts` (skip `chdir`), logging prefix |
| `ORDEM_HOME` | unset | `~/.ordem` | state dir, database path, logs |
| `ORDEM_STATE_DIR` | `$ORDEM_HOME/userdata`, or `$ORDEM_HOME/dev` when `NODE_ENV !== production` | passed explicitly: `<home>/userdata` packaged, `<home>/dev` in development | database, logs |
| `DATABASE_PATH` | `storage/<env>.sqlite3` under `ORDEM_ROOT`; `$ORDEM_STATE_DIR/ordem.sqlite3` when `ORDEM_HOME` is set | derived | `db/client.ts` |
| `ORDEM_ROOT` | repo root | unset | relative paths, `public/` default |
| `ORDEM_PUBLIC_DIR` | `$ORDEM_ROOT/public` | `<resources>/public` (real files, shipped as extraResources) | `http/frontend.ts`, protocol handler |
| `ORDEM_MIGRATIONS_DIR` | `backend/drizzle` next to the source | `<resources>/drizzle` | `db/migrate.ts` |
| `ORDEM_HOST` | `0.0.0.0` | `127.0.0.1` | `server.ts` listen |
| `PORT` | `3000` | a free port chosen per launch | `server.ts` listen |
| `ORDEM_DESKTOP_TOKEN` | unset (no auth) | 32 random bytes, hex, per launch | `http/desktop-auth.ts` |
| `ORDEM_ALLOWED_HOSTS` | unchanged | unset | `http/host-authorization.ts` |
| `ORDEM_LOG_LEVEL` | `info` | `info` | `lib/logger.ts` |
| `ORDEM_DISABLE_JOB_WORKER` | unset | unset | `index.ts` |
| `NODE_ENV` | unset in dev, `production` in Docker | `production` when packaged, `development` otherwise | state dir split, allowed hosts |

Desktop renderer origins, one constant in `http/host-authorization.ts`:
`ordem://app` (packaged) and `ordem-dev://app` (development). Both are accepted by the WebSocket
origin check and get CORS headers on `/api/*`. No other origin gets CORS headers.

Auth rules when `ORDEM_DESKTOP_TOKEN` is set: `/api/*` needs `Authorization: Bearer <token>`,
`/ws` needs `?token=<token>` on the upgrade request, `/up` and static files are open. Failure is
401 with the standard envelope and code `unauthorized`. Compare tokens with
`crypto.timingSafeEqual`.

## Implementation notes

What shipped differs from Part 2 in these places:

| Topic | Spec said | Implemented | Why |
|---|---|---|---|
| Window chrome on Windows and Linux | `titleBarStyle: 'hidden'` | native frame, menu bar hidden until Alt | a hidden frame needs window-controls-overlay CSS on whichever pane is rightmost; the native frame is correct everywhere today |
| Bridge | eight members | ten: adds `onBackendState` (reconnecting banner) and `setBadgeCount` (dock badge from the Inbox count) | phase 4 items, both through the bridge as 1.10 rule 3 asks |
| Dev server | `bin/dev-desktop` starts `bun --watch backend` on port 3000 with a fixed token | the shell spawns `bun --watch backend/src/index.ts` itself, free port and fresh token, as in a packaged run | one code path for dev and prod; `bin/dev-desktop` runs Vite, the shell bundle watcher and `desktop/scripts/dev-electron.ts` |
| Vite HMR over `ordem-dev://` | not covered | `ORDEM_DESKTOP_DEV=1` sets `server.hmr` host and client port in `vite.config.ts` | the custom scheme has no host or port for Vite's client to derive its socket from |
| electron-builder config | `electron-builder.config.ts` loaded by electron-builder | the same file exports `resolveBuildConfig`; `desktop/scripts/dist.ts` writes it to `release/builder-config.json` and runs the CLI | no TS loader needed; one script owns sync-version, frontend build, shell bundle, server compile, packaging and checks |
| `afterSign` hook | assert or sign the sidecar | `desktop/scripts/verify-mac.ts` after packaging: signature, `allow-jit` entitlement, hardened runtime and Developer ID when signed, then boots the sidecar from inside the bundle | electron-builder signs `Resources/server/ordem-server` itself (seen in the ad hoc build); the check is what matters |
| Unsigned macOS builds | DMG ships unsigned | ad hoc signed (`identity: '-'`) and no update feed (`publish: null`) | arm64 refuses unsigned code; Squirrel.Mac refuses ad hoc builds, so the app reports updates off instead of failing |
| Icons | `icon.icns`, `icon.ico`, `icons/*.png` in the repo | one `resources/icon.png` (1024 px, macOS grid) rendered from `public/icon.svg` by `desktop/scripts/icons.ts`; electron-builder derives the rest | fewer generated files to keep in sync |
| Windows installer name | `Ordem Setup x.y.z-x64.exe` | `Ordem-Setup-x.y.z-x64.exe` | GitHub turns spaces in asset names into dots, which breaks the URL in `latest.yml` |
| CLI shim | shim pointing at the sidecar | the sidecar entry (`backend/src/sidecar.ts`) runs the CLI when its first argument is `cli`; the shell keeps `desktop-connection.env` (URL and token, mode 0600) in the state dir while the server is up; the shim sources it | one binary; the token never lands in the shim |
| Inherited env stripping | `ORDEM_*` | also `FORGE_*`, `DATABASE_PATH`, `PORT`, `NODE_ENV`, `RAILS_ROOT`, `FRONTEND_DEV_URL`, `ELECTRON_RUN_AS_NODE` | the server still honours the legacy `FORGE_*` names, and `DATABASE_PATH` would move the database |
| macOS mac x64 runner | `macos-13` | `macos-15-intel` | `macos-13` is retired |
| Renderer permissions | not covered | only `notifications`, `clipboard-sanitized-write` and `fullscreen` are granted | review notifications already use the web `Notification` API, which Electron shows natively |

Verified locally on macOS arm64: unit tests for every pure module (`bun test ./desktop/test`), the
compiled sidecar booting from `/tmp`, `bun run dist:mac` with `verify-mac.ts`, `bun run desktop:smoke`
on the packaged app, and a scripted click-through of the packaged app over CDP (starting page, token
auth, About and updates, repositories folder, server crash and recovery with the banner, the CLI
through the connection file, clean quit). Linux AppImage and deb and the Windows NSIS installer were
cross-built from macOS; their smoke tests run in the release workflow on native runners.

## Appendix: probe results

2026-10-08, Bun 1.2.20, macOS arm64, this repo at `d1fe611`.

```
bun build --compile --target=bun backend/src/index.ts --outfile /tmp/ordem-probe/ordem-server
  bundle 502 modules (65 ms), compile (198 ms), 60.8 MB

cd /tmp/ordem-probe && PORT=3977 DATABASE_PATH=/tmp/ordem-probe/probe.sqlite3 \
  ORDEM_DISABLE_JOB_WORKER=1 NODE_ENV=production ./ordem-server
  error: Can't find meta/_journal.json file
    at readMigrationFiles (/$bunfs/root/ordem-server:29953)
    at migrateDatabase   <- backend/src/db/migrate.ts resolves ../../drizzle from import.meta.url

bun build --compile --target=bun-darwin-arm64   ok   60.8 MB
bun build --compile --target=bun-linux-x64      ok  104.9 MB
bun build --compile --target=bun-windows-x64    ok  119.6 MB (.exe)
```

T3 Code files read for Part 1: `apps/desktop/src/main.ts`, `backend/DesktopBackendManager.ts`,
`backend/DesktopBackendConfiguration.ts`, `electron/ElectronProtocol.ts`,
`window/DesktopWindow.ts`, `preload.ts`, `ipc/channels.ts`, `shell/DesktopShellEnvironment.ts`,
`updates/DesktopUpdates.ts`, `app/DesktopEnvironment.ts`, `apps/server/vite.config.ts`,
`apps/server/src/http.ts`, `apps/server/src/cli/server.ts`, `scripts/lib/cli-external-packages.ts`,
`scripts/lib/desktop-external-packages.ts`, `scripts/build-desktop-artifact.ts`,
`.github/workflows/release.yml`, `.github/workflows/release-desktop.yml`,
`docs/internals/overview.md`, `docs/operations/release.md`, `docs/user/install.md`,
`docs/user/updating.md`, `docs/internals/server-updates.md`.

### Spike, 2026-10-08: Electron + signed Bun sidecar on macOS

Backend compiled from a copy with one change (migrations dir from `ORDEM_MIGRATIONS_DIR`, the A1
change). Electron 44.7.0, Bun 1.2.20, macOS arm64, ad hoc signing.

| Check | Result |
|---|---|
| `codesign --options runtime` + entitlements `allow-jit`, `allow-unsigned-executable-memory`, `disable-executable-page-protection` | boots, `/up` 200, `/api/v1/status` 200, frontend served, clean exit on SIGTERM |
| `codesign --options runtime` without entitlements (control) | dies at startup: "Ran out of executable memory while allocating 128 bytes", crash report written |
| Electron main spawns the signed binary, polls `/up`, loads the UI | ready after 355 ms, UI rendered, `before-quit` sent SIGTERM, child exited 0, pid gone |
| Windows stop semantics | not tested, tracked in plan item C6 |

Conclusion: the sidecar approach holds on macOS. The entitlement list above is required. Real
notarization still needs an Apple Developer account (C8), but it checks the same hardened runtime
rules this spike exercised.
