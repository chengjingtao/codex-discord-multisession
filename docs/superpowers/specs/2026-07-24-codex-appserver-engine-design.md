# Codex Discord Bridge — app-server engine mode (form A: live same-source)

Date: 2026-07-24
Status: approved design, pending spec review → implementation plan
Repo: `chengjingtao/codex-discord-multisession` (fork of `ccuuu/codex-discord-multisession`)

## 1. Goal

Give the existing Codex Discord bridge a **form-A experience**: a terminal
`codex` session and its bound Discord thread are the **same live session**.
You can speak from either side and see the other side's turns stream in real
time. This matches what the Claude Code discord plugin feels like, but is built
on Codex's own `app-server` rather than a Claude-private hook.

### Non-goals
- Multi-machine. Single host only (bridge + terminal share `localhost`), same
  as the existing bridge and the claude plugin.
- Replacing the existing `exec` engine. app-server mode is **added alongside**
  it behind `CODEX_ENGINE`; `exec` stays the default so current users are
  unaffected.

## 2. Why the current engine can't do form A

The current bridge runs `codex exec resume --json <threadId> <prompt>`
(`src/codex-runner.ts:58`): each Discord message forks a **one-shot** codex
process that shares only the on-disk rollout file, then exits. An interactive
terminal `codex` is a **separate live engine** writing the same rollout.

- Two live processes writing one rollout ⇒ corruption.
- A terminal TUI does not observe turns another process ran.

So exec mode allows **turn-taking handoff at best, never a live mirror**.

## 3. Verified foundation (live spikes, codex 0.145.0)

All confirmed on this host by driving `codex app-server` directly:

1. `codex app-server --listen ws://127.0.0.1:PORT` runs the codex engine minus
   the TUI, as line-delimited JSON-RPC. Binds localhost only; supports an
   optional bearer token (`--remote-auth-token-env`).
2. **Multi-client live mirror works bidirectionally.** Two clients that each
   `thread/resume` the same *persisted* thread both receive every turn's
   `turn/started` → `item/agentMessage/delta` → `turn/completed`, no matter
   which client called `turn/start`. (spike5: A drives → both see deltas; B
   drives → both see deltas.)
3. **Rollout persistence is lazy.** `thread/start` returns the threadId and its
   future rollout path, but the file does **not** exist yet; a second client's
   `thread/resume` fails with `no rollout found`. A cheap **`thread/inject_items`
   (no model call) flushes the rollout**, after which resume succeeds. (spike6.)
4. **The terminal attaches with** `codex resume <threadId> --remote ws://…`
   (both flag orders parse; `resume` accepts `--remote` and
   `--remote-auth-token-env`). This targets the exact Discord-bound thread on
   the bridge's app-server — the crux of "same source."
5. `codex remote-control` / `codex app-server daemon` need the managed
   standalone install (absent here) — **not required**; we run
   `codex app-server --listen` ourselves.
6. app-server exposes per-thread `approvalPolicy` (`untrusted` | `on-request` |
   `never` | granular), `sandbox` (`read-only` | `workspace-write` |
   `danger-full-access`), and `approvalsReviewer` (`user` default, or
   `auto_review` subagent). Approvals are **server→client reverse requests**
   (`item/commandExecution/requestApproval`, `item/fileChange/requestApproval`,
   `item/permissions/requestApproval`) carrying `approvalId`, `command`, `cwd`,
   `reason`. Resolution broadcasts `serverRequest/resolved`.

## 4. Architecture

```
        ┌───────────────── bridge process (long-lived) ─────────────────┐
Discord │  discord.js Gateway  ◄──►  event router / bindings / commands │
Gateway │        │                          │                           │
  ◄────►│        ▼                          ▼                           │
        │  app-server client  ──── ws ────►  codex app-server           │◄─┐
        │  (turn/start, reads event stream)  (single live engine, N thr) │  │
        └────────────────────────────────────────────────────────────────┘  │
                                                                    ws (--remote)
   terminal:  codex resume <threadId> --remote ws://127.0.0.1:PORT ──────────┘
```

- **codex app-server** — one process, hosts N threads (one per Discord thread).
  Bridge spawns and supervises it. `ws://127.0.0.1:PORT`, optional bearer token.
- **bridge app-server client** — replaces the `codex exec` invocation. Maps
  Discord I/O ↔ JSON-RPC.
- **terminal** — a normal contributor via `codex resume … --remote`; not a
  second engine, just another view.

**Core invariant: one thread ⇒ one live engine (inside app-server).** Neither
Discord nor terminal runs its own engine; both are views. This is what makes
the live mirror sound and sidesteps the rollout-write race.

## 5. Components (build-on-existing map)

| Concern | Source | Change |
| --- | --- | --- |
| Discord gateway, threads, message send/edit | `src/discord-daemon.ts` | reuse |
| Discord-thread ↔ codex-thread bindings | `src/bindings.ts` | reuse + store PORT/token |
| Command surface `!codex/!resume/!sessions/!attach/!stop/!queue/!pause/!status` | `src/discord-daemon.ts` | reuse; extend `!attach` to print the `--remote` line |
| Event → Discord formatting | `src/discord-daemon.ts` | reuse; retarget to app-server event names |
| Structured questions (`ask_user_question`) | `src/discord-ask-mcp.ts` | reuse (engine-agnostic MCP) |
| Bot-author allowlist | PR #1 branch | reuse |
| **Engine driver** | `src/codex-runner.ts` | **replace** with app-server client |
| **app-server lifecycle** (spawn/supervise/port/token) | — | **new** |
| Config `CODEX_ENGINE=exec\|app-server`, PORT, token | `src/config.ts` | extend |

New modules (tentative): `src/appserver-manager.ts` (spawn/supervise the
app-server, health, restart), `src/appserver-client.ts` (JSON-RPC framing,
request/notify, reverse-request handling), `src/appserver-runner.ts` (the
`CodexRunOptions`-shaped adapter so `discord-daemon.ts` calls stay stable).

## 6. Key data flows

### 6.1 `!codex [--cwd p] [--name n] [prompt]` (open new session)
1. `createThread(parent, name)` — name from `--name` or `threadNameFromPrompt`.
2. `thread/start {cwd, approvalPolicy, sandbox, approvalsReviewer}` → threadId.
3. **`thread/inject_items` priming item** → flush rollout to disk (required so
   the terminal can attach). 
4. Persist binding `discordThreadId ↔ codexThreadId` (+cwd, codexHome, port).
5. Post a landing message including the ready-to-copy attach line:
   `codex resume <threadId> --remote ws://127.0.0.1:PORT`.
6. If a prompt was given, `turn/start` it and stream the reply.

### 6.2 Inbound Discord message (existing thread)
- Look up binding → codexThreadId.
- If thread idle → `turn/start {threadId, input}`.
- If a turn is in flight → `turn/steer {threadId, input}` (mid-turn add) or
  queue (respect existing `!queue`/`!pause` semantics).
- Stream `item/agentMessage/delta` into a Discord message, `edit_message`
  throttled ~1–2 s; on `turn/completed`, finalize + send a fresh message so the
  device pings.

### 6.3 Terminal attach / detach
- User runs the printed `codex resume <id> --remote ws://127.0.0.1:PORT`.
- app-server loads the thread for that connection; both terminal and bridge now
  receive all turn events. Either side can drive turns.
- Detach = quit the TUI. Bridge stays; binding persists; re-attach anytime.

### 6.4 Approvals (terminal + Discord both present)
- Default policy: `sandbox: workspace-write`, `approvalPolicy: on-request`,
  `approvalsReviewer: user`.
- A command/patch needing approval arrives as a reverse request. Bridge posts
  it to Discord with ✅/❌ reactions and answers the reverse request with the
  reaction.
- If the terminal is attached and the human approves natively there, the bridge
  observes `serverRequest/resolved` and retracts/updates the Discord prompt (no
  double-answer).
- `ask_user_question` (ask-MCP) remains for model-initiated structured choices.
- Optional per-session `approvalsReviewer: auto_review` for hands-off,
  Discord-only sessions (documented, off by default).

## 7. Error handling
- **app-server crash** → manager restarts it; in-memory (unpersisted) turns are
  lost but rollouts on disk survive; bridge re-`thread/resume`s active bindings
  and posts a "reconnected" notice.
- **ws disconnect** (bridge↔app-server) → reconnect with backoff; pending
  `turn/start` promises reject → Discord shows a retriable error.
- **Attach before flush** → guaranteed not to happen for `!codex` (step 6.1.3
  flushes); for `!resume` of an existing thread the rollout already exists.
- **Bad token / port in use** → fail fast at bridge start with a clear message
  (mirror existing spawn-error ergonomics in `codex-runner.ts:39`).
- **Turn interrupt** (`!stop`) → `turn/interrupt`; existing SIGINT path retired
  for app-server mode.

## 8. Testing strategy
- **Unit**: JSON-RPC framing (reuse pattern from existing `framing`/`smoke`
  tests), request/response correlation, reverse-request routing, event→Discord
  formatter mapping (fixtures of app-server notifications → expected Discord
  text), binding persistence.
- **Fake app-server**: a scriptable stub speaking the JSON-RPC subset, to drive
  daemon flows without a real model (mirrors the existing `discord-ops.fake`
  approach).
- **Integration (gated, real codex)**: the spike scripts (spike5/spike6)
  promoted into `docs/verification.md` — start app-server, open thread, flush,
  drive a turn, assert deltas; a second client mirrors.
- **Manual smoke**: `!codex` → attach terminal → drive from each side → approve
  a command from each side.

## 9. Open items (resolve in Phase 0 of implementation)
1. Exact multi-client **broadcast/dedup semantics of approval reverse requests**
   — verify with a live approval whether both clients receive the request and
   how `serverRequest/resolved` dedups. Design already has a safe fallback
   (bridge owns approvals) regardless.
2. Confirm the terminal TUI, when attached via `--remote`, renders bridge-driven
   turns acceptably (deltas proven at protocol level; verify UX).
3. Port/token allocation policy for multiple bridges on one host (align with the
   existing `DISCORD_STATE_DIR` multi-bot pattern).

## 10. Reuse & licensing
Build on the fork; keep Apache-2.0 headers. The claude plugin's Discord-core
files are not copied (this repo already has its own mature Discord layer).
