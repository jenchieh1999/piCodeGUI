# Pi Agent Desktop

[Chinese README](./README.zh-CN.md)

Pi Agent Desktop is a desktop workbench for `pi-agent`. It packages a local Pi agent server, a modern React workspace, and an Electron desktop shell into one Windows-oriented desktop application.

The project started with the goal of bringing the interaction quality of desktop Claude Code-style tools to Pi Agent while keeping the runtime extensible. It now includes a chat workspace, project switching, permissions, agents, channels, terminal support, Markdown/code readers, custom themes, standalone tool windows, and a Windows packaging pipeline.

> Current status: private pre-release, version `0.1.1`. The main desktop workflow is usable, but formal release hardening still depends on signed installers, a configured update feed, more regression coverage, and real upgrade-path testing.

## Highlights

- Electron desktop shell with native window controls, tray/menu integration, dynamic local server startup, diagnostics, app icon assets, and auto-update plumbing.
- Local `pi-server` that hosts HTTP APIs and WebSocket events for sessions, messages, runtime state, permissions, agents, channels, workspace files, Git context, and terminals.
- React 19 + Vite frontend with Zustand stores, Tailwind CSS 4, Radix primitives, lucide icons, xterm, Shiki, Mermaid, Marked, DOMPurify, and QR code rendering.
- Chat-centric workspace with session list, auto-generated conversation titles, fork actions on assistant answers, scroll-to-bottom affordance, selectable/copyable message content, queued follow-ups, file references, slash commands, model/thinking/permission controls, and workspace switching.
- Permission flow shown inside the chat surface, with rules, audit entries, command/file previews, and runtime permission modes.
- Agents, skills, tasks, packages, extensions, provider settings, desktop diagnostics, and channel configuration views.
- Feishu and WeChat channel foundations, including Feishu App ID/App Secret binding, encrypted event decryption, pairing codes, WeChat Official Account access-token sending, and WeChat QR login flow for personal channel binding.
- Built-in xterm terminal backed by PTY/ConPTY when available, with pipe fallback, resize support, docked and standalone modes, and workspace-aware startup.
- Markdown reader/editor with preview/source/split modes, synchronized scroll lock, theme sync, save support, search/replace, undo, tab indentation, and standalone window/tab support.
- Code file viewer with standalone windows, search/replace, undo, and shared tab management.
- Standalone tool windows for Markdown, code files, and terminals, with tab grouping, detach, merge, and drag-based window splitting workflows.
- Theme system with 20+ built-in styles, user-created themes, local overrides for built-in themes, deletable/resettable themes, reset-to-default settings, font settings, chat background image support, and additional Claude Code, Codex, Trae, Cyberpunk, and Star Wars-inspired themes.
- Windows build pipeline through `electron-builder`, configured for one NSIS dual-arch installer that contains both `x64` and `ia32`.

## Architecture

The repository is an npm workspace with three main packages:

```text
piCodeGUI/
+-- desktop/       Electron main/preload process, native shell, update bridge, standalone windows
+-- frontend/      React/Vite desktop UI
+-- pi-server/     Local Node/TypeScript server for Pi runtime, sessions, channels, workspace, terminal
+-- docs/          Development plans, cc-haha gap analysis, progress reports
+-- scripts/       Quality and icon generation helpers
+-- release/       electron-builder output
+-- package.json   Workspace scripts and shared desktop build entrypoints
```

### Desktop Shell

`desktop/main.cjs` is the Electron entrypoint. It is responsible for:

- creating the main desktop window and standalone tool windows;
- generating a local auth token for the renderer and server;
- starting `pi-server` on a dynamic loopback port;
- forwarding desktop environment details through `desktop/preload.cjs`;
- handling Markdown/code/terminal standalone tabs;
- exposing auto-update operations through `electron-updater`;
- applying app icons and native window behavior.

`desktop/preload.cjs` exposes a narrow bridge such as server environment discovery, update status, window state events, and standalone tab operations.

### Frontend Workbench

`frontend/src` contains the React application. Important areas include:

- `App.tsx`: route selection for main shell and standalone windows.
- `api/client.ts`: HTTP and WebSocket client for the local server.
- `stores/`: Zustand stores for chat, settings, model, UI, connection, terminal, tasks, agents, and extensions.
- `components/chat/`: conversation view, input composer, message list, permissions, thinking blocks, tool cards, workspace switcher.
- `components/layout/`: app shell, sidebar, right panel, status bar, tabs.
- `components/markdown/`: Markdown renderer, reader/editor, standalone view.
- `components/workspace/`: code/file standalone viewer.
- `components/terminal/`: terminal standalone view.
- `components/settings/`: settings, themes, channels, packages, extensions.
- `components/agents/`, `components/skills/`, `components/tasks/`: higher-level workflow panels.

The UI is designed as a desktop workbench rather than a landing page. The left sidebar owns primary navigation, the center area owns conversation, the right/bottom areas own workspace tools, and detached windows are used for deep reading/editing workflows.

### Local Pi Server

`pi-server/index.ts` starts the local HTTP/WebSocket service. It provides:

- health and diagnostics endpoints;
- session/message lifecycle;
- Pi runtime adapter and mock fallback;
- model/provider/auth APIs;
- permission broker, permission rules, and audit trail;
- workspace tree, file read/write, diff/search, and repository context;
- terminal start/input/resize/stop protocol;
- Feishu and WeChat channel APIs;
- agent configuration APIs;
- persistence under the desktop data directory.

The server is started by Electron for the desktop app, but can also be run directly for development.

## Requirements

- Windows is the primary target for packaging and manual verification.
- Node.js compatible with the repository dependencies.
- npm workspaces support.
- Native PTY support is optional. If native PTY cannot load, the terminal falls back to a pipe backend.
- For external channels, public webhook access or a tunnel is required. Localhost callbacks are not reachable by Feishu/WeChat cloud services.

## Quick Start

Install dependencies:

```bash
npm install
```

Run the desktop development environment:

```bash
npm run desktop:dev
```

Run frontend and server without the Electron shell:

```bash
npm run dev
```

Build frontend and server:

```bash
npm run build
```

Run the desktop preview from built assets:

```bash
npm run desktop:preview
```

## Development Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run Vite frontend and `pi-server` together. |
| `npm run desktop:dev` | Run Vite frontend and Electron desktop shell. Electron starts the local server. |
| `npm run dev:frontend` | Run only the Vite frontend. |
| `npm run dev:server` | Run only `pi-server` in watch mode. |
| `npm run build` | Build frontend and server. |
| `npm run typecheck` | Type-check frontend and server. |
| `npm run server:smoke` | Build and run server protocol smoke checks. |
| `npm run desktop:smoke` | Build server and run Electron smoke checks. |
| `npm run quality` | Run typecheck, build, smoke checks, and repository quality checks. |
| `npm run quality:release` | Run the release quality gate, including packaged checks. |
| `npm run desktop:pack` | Build unpacked Electron directory output. |
| `npm run desktop:dist` | Build distributable Electron artifacts. |

## Packaging

Windows packaging is configured in `electron-builder.yml`.

Current output:

- product name: `Pi Agent Desktop`;
- app id: `works.pi-agent.desktop`;
- output directory: `release`;
- target: NSIS;
- architectures: dual-arch installer with both `x64` and `ia32`;
- icon: `desktop/assets/pi-icon.ico`;
- `asar`: enabled;
- `pi-server/dist` and `node_modules` are unpacked for runtime access to server files and native modules.

Build installer artifacts:

```bash
npm run desktop:dist
```

Build unpacked app directory:

```bash
npm run desktop:pack
```

## Auto Update

The desktop shell includes an `electron-updater` integration. The renderer can query update state, check for updates, download updates, and install downloaded updates.

Supported environment variables:

| Variable | Purpose |
| --- | --- |
| `PI_DESKTOP_UPDATE_URL` | Generic update feed URL. |
| `PI_DESKTOP_GITHUB_REPOSITORY` | GitHub release repository in `owner/repo` form; inferred from `origin` when omitted. |
| `GH_TOKEN` / `GITHUB_TOKEN` | GitHub Release upload credential, read only from the environment. |
| `PI_DESKTOP_PUBLISH_PROVIDER` | Publish provider: `github` or `local`. |
| `PI_DESKTOP_PUBLISH_DIR` | Target directory for the `local` publish provider. |
| `PI_DESKTOP_UPDATE_CHANNEL` | Update channel, default `latest`. |
| `PI_DESKTOP_DISABLE_AUTO_UPDATE=1` | Disable auto update checks. |
| `PI_DESKTOP_UPDATE_PRERELEASE=1` | Allow prerelease updates. |

For formal Windows releases, use the release script. If the repository has a GitHub `origin`, the update feed is inferred as `https://github.com/<owner>/<repo>/releases/latest/download`:

```powershell
npm run desktop:dist:release
```

Publish to GitHub Releases:

```powershell
$env:GH_TOKEN="ghp_xxx"
npm run desktop:publish
```

Or build and upload in one command:

```powershell
$env:GH_TOKEN="ghp_xxx"
npm run desktop:release
```

Publish to a static directory:

```powershell
$env:PI_DESKTOP_PUBLISH_PROVIDER="local"
$env:PI_DESKTOP_PUBLISH_DIR="D:\static\pi-agent-desktop\latest"
npm run desktop:publish
```

Whichever provider is used, the update-feed directory must contain `latest.yml`, the matching `.exe` files, and `.blockmap` files.

Release builds are pruned to the combined dual-arch installer only:

- `Pi-Agent-Desktop-<version>-win.exe`
- `Pi-Agent-Desktop-<version>-win.exe.blockmap`
- `latest.yml`

Important caveats:

- Auto update is meaningful only in packaged builds.
- A real release feed must be configured before production use.
- Code signing and upgrade-path regression testing are still required for release-grade distribution.

## Runtime and Data

Electron starts `pi-server` with a generated auth token and a desktop data directory. The server persists sessions, messages, settings-related records, channel configuration, and other local state.

Useful environment variables:

| Variable | Purpose |
| --- | --- |
| `PI_DESKTOP_FRONTEND_URL` | Override the frontend URL loaded by Electron in development. |
| `PI_DESKTOP_NODE` | Override the Node executable used to start the server. |
| `PI_DESKTOP_DATA_DIR` | Override local desktop data directory. Electron sets this automatically. |
| `PI_DESKTOP_AUTH_TOKEN` | Bearer token used by HTTP and WebSocket APIs. Electron generates this automatically. |
| `PI_DESKTOP_SHELL` | Runtime shell marker, set to `electron` by the desktop app. |
| `PORT` | Server port when running `pi-server` directly. |
| `HOST` | Server host, default loopback. |
| `PI_AGENT_PERMISSION_MODE` | Default permission mode for runtime actions. |

## Security Model

- The desktop app keeps `pi-server` on loopback by default.
- Electron generates an auth token and passes it to both server and renderer.
- HTTP management APIs require `Authorization: Bearer ...` when token auth is enabled.
- WebSocket connections use the token in the connection query.
- CORS is restricted to loopback, `file`, and null origins when auth is enabled.
- `/health` and public channel webhook endpoints remain externally reachable where needed.
- Packaged UI assets do not depend on remote font CDNs.
- Electron blocks remote non-HTTPS external links; loopback HTTP remains available for local tools.
- Custom SkillHub endpoints must use HTTPS for remote hosts. HTTP is accepted only for loopback development unless `PI_AGENT_ALLOW_INSECURE_SKILLHUB_ENDPOINTS=1` is set.
- Do not expose the local server to a wider network unless you add an explicit security boundary.

## Chat Workspace

The central workspace is designed around conversation-driven coding:

- create, resume, rename, delete, and fork sessions;
- generate session titles from conversation content;
- choose a workspace folder from the chat area;
- send queued follow-up messages;
- add workspace files or selected text as context;
- use slash commands and file search;
- switch model, thinking level, and permission mode;
- review permission requests inline;
- select/copy assistant and user messages;
- jump to the bottom only when the conversation is scrolled away from the bottom.

Assistant responses expose a fork action so users can branch from a specific answer and continue exploration without losing the original timeline.

## Workspace, Markdown, Code, and Terminal

Workspace tools are available in the right panel, below the input composer, and as detached windows depending on the feature.

Markdown reader/editor:

- preview, source, and split modes;
- scroll-sync lock in split mode;
- theme synchronization with the desktop theme;
- edit/save support;
- Ctrl+F search and replace;
- Ctrl+Z undo;
- tab indentation;
- standalone windows and detachable tabs.

Code viewer:

- standalone viewing;
- search and replace;
- undo;
- tab grouping with other standalone tools.

Terminal:

- xterm frontend;
- PTY/ConPTY backend when available;
- pipe fallback when native PTY cannot load;
- resize protocol;
- docked and detached layouts;
- session/workspace-aware startup.

Standalone windows can hold multiple tabs. Tabs can be detached into another window or merged back into an existing group.

## Agents, Skills, Tasks, and Extensions

The application includes dedicated views for:

- agent configuration and channel assignment;
- skills and extension-style capabilities;
- scheduled tasks;
- installed packages and extension management;
- desktop diagnostics and runtime settings.

The agents experience has been adjusted toward desktop agent workbench patterns inspired by tools such as ClawX/OpenClaw while staying within the current Pi Agent runtime boundaries.

## Channels

Channels connect external message surfaces to Pi Agent sessions and agents.

### Feishu

Implemented foundations:

- bind channel through App ID and App Secret;
- store webhook, verification token, signing secret, encryption key, recipient, and project/session defaults;
- decrypt encrypted Feishu events when encryption is configured;
- generate pairing codes for recipient binding;
- send outbound messages through configured credentials;
- route inbound channel messages to sessions or agents.

Notes:

- Feishu event callbacks require a public HTTPS URL or a tunnel.
- Local desktop callback URLs are useful for configuration display but cannot be called by Feishu cloud services directly.
- Verify App ID, App Secret, callback URL, verification token, signing secret, and encryption key together when events do not arrive.

### WeChat

Implemented foundations:

- WeChat Official Account-style configuration with App ID/App Secret and default recipient;
- access-token based outbound sending path;
- inbound webhook handling;
- personal WeChat QR login flow based on the OpenClaw/iLink-style approach;
- QR image rendering in the desktop UI;
- polling for login status, optional verification code entry, and bot token persistence.

Notes:

- Official Account proactive messages require valid credentials and a valid recipient/OpenID.
- Personal QR binding depends on the external iLink-compatible service flow and phone confirmation.
- Keep the desktop app open while the QR flow is polling.

## Themes and Appearance

The settings area supports:

- built-in theme selection;
- at least 20 color styles;
- custom theme creation, editing, deletion, and reset;
- built-in theme local editing and deletion through local override/hide records, with reset restoring bundled defaults;
- reset settings to defaults without deleting channel credentials, sessions, or packages;
- chat background images;
- font family and font size settings;
- dedicated theme styles inspired by Claude Code, Codex, Trae, Cyberpunk, and Star Wars;
- live theme propagation to the desktop shell, Markdown reader, code viewer, and standalone windows.

## Quality and Verification

Recommended checks before shipping changes:

```bash
npm run typecheck
npm run build
npm run server:smoke
npm run desktop:smoke
npm run quality
```

Network/security-oriented checks:

```bash
npm audit --omit=dev --audit-level=moderate
npm audit --audit-level=high
node --check desktop/main.cjs
node --check desktop/preload.cjs
```

For release-oriented validation:

```bash
npm run quality:release
```

Current automated coverage is strongest around type-checking, build output, server smoke checks, desktop smoke checks, auth/token behavior, and packaging smoke paths. Component-level and store/API regression tests should continue to expand as UI complexity grows.

## Troubleshooting

### The desktop window is black

- Run `npm run build` and restart the desktop app.
- In development, confirm Vite is running on the URL Electron loads.
- Check desktop diagnostics and logs under the local app data/log directory.
- Confirm `pi-server` health is reachable from the frontend.

### Messages show "Pi server is not connected"

- Restart the desktop shell so Electron can restart `pi-server`.
- Confirm no stale server process is occupying the expected port.
- Check the connection status and diagnostics view.
- When running outside Electron, make sure the frontend points to the correct server base URL.

### Terminal falls back or exits

- Native PTY may fail to load on some Electron/Node/native-module combinations.
- The app falls back to a pipe backend instead of crashing.
- Rebuild or reinstall dependencies if PTY support is required.
- Keep terminal views docked or detached through the app controls rather than relying on page switches to preserve state.

### Markdown save fails with `failed to fetch`

- Confirm the local server is connected.
- Confirm the file belongs to the selected workspace and is writable.
- Restart the desktop shell if the server token or base URL changed.

### Feishu or WeChat configuration does not take effect

- Save the channel first, then run the test/bind operation.
- Verify credentials, recipient, callback URL, and pairing code.
- Use a public HTTPS callback or a tunnel for cloud events.
- Check channel `lastError`, desktop diagnostics, and server logs.

### Auto update shows unsupported

- Auto update is unsupported in dev/smoke mode.
- Package the app and configure `PI_DESKTOP_UPDATE_URL`.
- Signing and release feed metadata are required for production-grade update behavior.

## Roadmap

High-priority items:

- release signing, stable update feed, and upgrade regression testing;
- broader component/store/API tests;
- deeper SDK-native session resume/fork alignment;
- provider `baseURL` and proxy configuration;
- richer workspace diff accept/reject workflow;
- stronger diagnostics for channels, providers, runtime, and terminal;
- channel reliability hardening for Feishu and WeChat production deployments;
- continued UI polish toward a native, calm, Apple-style desktop workbench.

## References

- `docs/pi-agent-desktop-implementation-plan.md`
- `docs/pi-agent-vs-cc-haha-gap-analysis.md`
- `docs/pi-agent-desktop-self-review-2026-05-17.md`
- `docs/pi-agent-desktop-runtime-progress-2026-05-17.md`
- `docs/pi-agent-desktop-progress-2026-05-18.md`
- `docs/pi-agent-desktop-ai-development-handoff.md`
- `docs/pi-agent-desktop-release-security-audit-2026-05-20.md`
- `docs/pi-agent-desktop-release-security-manual-steps.md`
