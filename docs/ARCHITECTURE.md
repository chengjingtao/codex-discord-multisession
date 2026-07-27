# Architecture & Design Principles

This is the living design reference for the Codex Discord bridge. Read it
before extending the bridge — new work should build on the capabilities and
principles described here.

Point-in-time design/plan docs live under `docs/superpowers/`; this file is the
consolidated, current picture.

---

## 1. What this is

A bridge that runs **Codex CLI sessions from chat**. Each Discord thread maps to
one persistent Codex `thread_id`; follow-up messages continue that session.

The headline capability is **form A — live same-source**: a terminal Codex
session and its bound Discord thread are the *same live session*. You can speak
from either side and see the other side's turns stream in real time. This is
achieved with Codex's own `app-server`, not a Codex-private hook.

There is also a local-only `codex-wechat` bridge that reuses the same engine
layer (see README). This document focuses on the Discord bridge.

---

## 2. Engines

The bridge drives Codex through one of two engines, selected by `CODEX_ENGINE`.

| | `app-server` (**default**) | `exec` |
| --- | --- | --- |
| Codex invocation | one long-lived `codex app-server` (JSON-RPC over ws) | one `codex exec resume --json` per message |
| Live terminal same-source | **yes** — attach with `codex resume <id> --remote ws://…` | no (turn-taking handoff only) |
| Mid-session concurrency | one live engine, many views | two processes share only the rollout file |
| Requires | Codex ≥ 0.145 with `app-server` | any Codex with `codex exec --json` |

`app-server` is the default because it delivers the live same-source
experience. Set `CODEX_ENGINE=exec` (env or `config.json`) to fall back — e.g.
on an older Codex, or for a purely non-interactive setup.

Both engines feed the **same internal event shape** to the daemon (see §4), so
everything above the engine — commands, bindings, rendering, ask-MCP — is
engine-agnostic.

---

## 3. Runtime architecture (app-server / form A)

```
        ┌───────────────── bridge process (long-lived) ─────────────────┐
Discord │  discord.js gateway  ◄──►  event router / bindings / commands │
gateway │        │                          │                           │
  ◄────►│        ▼                          ▼                           │
        │  app-server client  ──── ws ────►  codex app-server           │◄─┐
        │  (turn/start, reads event stream)  (single live engine, N thr) │  │
        └────────────────────────────────────────────────────────────────┘  │
                                                                    ws (--remote)
   terminal:  codex resume <threadId> --remote ws://127.0.0.1:PORT ──────────┘
```

- **codex app-server** — one process, hosts N threads (one per Discord thread).
  The bridge spawns and supervises it (`AppServerManager`). Binds `127.0.0.1`
  only; optional bearer token.
- **bridge app-server client** (`AppServerClient`) — the persistent JSON-RPC
  client the daemon uses to drive turns and receive the event stream.
- **terminal** — a normal contributor via `codex resume … --remote`; not a
  second engine, just another view of the same thread.

**Core invariant: one thread ⇒ one live engine (inside app-server).** Neither
Discord nor the terminal runs its own engine; both are views. This is what makes
the live mirror sound and avoids the rollout-write race that makes `exec`
handoff turn-taking-only.

---

## 4. The translation layer (why the daemon is engine-agnostic)

The daemon renders and formats **exec-JSON events** — the shape `codex exec
--json` emits (`thread.started`, `item.started`/`item.completed` with
`command_execution` / `agent_message` / `reasoning`, `turn.*`). The `exec`
engine produces these natively.

The `app-server` engine emits richer **v2 notifications** (`item/completed`,
`item/agentMessage/delta`, `turn/completed`, …). `src/appserver-protocol.ts`
**translates** each v2 notification into the exec-JSON shape. So the daemon
never learns two event vocabularies — it consumes one, and both engines feed it.

**Principle — translate, don't special-case.** When Codex adds an event type
you want to surface, translate it into the internal exec-JSON shape once; every
consumer (rendering, finalText extraction, `!status`) gets it for free.

---

## 5. Session lifecycle (`!codex`)

1. `createThread(parent, name)` — a Discord thread (`--name` or derived).
2. `thread/start { cwd, sandbox, approvalPolicy }` → a `threadId`.
3. **`thread/inject_items`** (a priming item, no model call) — flushes the
   rollout to disk. *Required*: `thread/start` alone does not persist the
   rollout, and a terminal `codex resume --remote` fails with `no rollout found`
   until it exists.
4. Persist the binding `discordThreadId ↔ codexThreadId` (+ cwd, codexHome).
5. Post a landing message with the ready-to-copy terminal attach command.
6. If a prompt was given, `turn/start` it and stream the reply.

Inbound messages on an existing thread → `turn/start` (idle). If the engine has
evicted the thread from memory (e.g. after an app-server restart), `turn/start`
fails `thread not found`; the runner then `thread/resume`s it from the on-disk
rollout and retries once (`src/appserver-runner.ts`).

One live Codex turn per Discord thread at a time. A plain message sent mid-turn
is **auto-queued** and runs when the current turn finishes (`!stop` interrupts so
it starts now; `!queue` queues explicitly).

---

## 6. Rendering principles (readable, terminal-like)

Goal: Discord output reads like the terminal, with the **agent's prose as the
visual focus** and everything else receding. Pure formatters live in
`src/discord-render.ts` (unit-tested); the daemon calls them per item.

- **Agent prose** → clean standalone markdown message, prefixed `💬`. This is
  the focus.
- **Command execution** → a *lightweight* muted subtext line
  `-# ✓/✗ \`command\` · exit N · Xs` (monochrome glyphs, not emoji, so they
  don't compete with the prose or the `✅ 完成` status). The `/bin/bash -lc '…'`
  wrapper is unwrapped to show the inner command. **Successful commands show no
  output; failures expand the output** capped to ~12 lines / 1200 chars with a
  `… +N 行` marker.
- **Reasoning** → collapsed spoiler `🧠 ||…||` (hidden by default).
- **Live status** → one lightweight line `⏳ Codex 运行中 (Ns) · \`!stop\` 中断`,
  edited at most every **1.5 s** (Discord rate limits forbid token streaming),
  finalized to `✅ 完成 (Ns)`.
- Renders are **serialized** per turn (`active.renderChain`) so messages keep
  event order; the duplicate final `agent_message` is not re-sent when it was
  already rendered live.

**Principle — the answer is the focus; secondary signal recedes.** New render
types should follow this weight ordering: prose (normal) > status (normal, one
line) > commands/reasoning (subtext / collapsed).

---

## 7. Access & security

- **Single host by design.** The app-server binds `127.0.0.1` only; terminal
  attach is same-host. Optional bearer token via `CODEX_DISCORD_APP_SERVER_TOKEN_ENV`.
- **Bot-author allowlist.** Messages from bots are ignored to avoid loops,
  *except* IDs in `allowBotAuthorIds` / `CODEX_DISCORD_ALLOW_BOT_IDS` — this is
  how a trusted external bot (e.g. a Claude Discord session) can trigger
  `!codex`.
- **Sandbox** is passed through to Codex (`CODEX_SANDBOX`, default
  `workspace-write`). `danger-full-access` only when you mean it.
- **Asking the human — engine-specific.**
  - `exec` mode auto-injects a local `ask_user_question` MCP tool so Codex can
    ask in-thread (buttons / selects / modal) before ending a turn. It routes by
    per-exec env (`CODEX_DISCORD_THREAD_ID`). Disable with `CODEX_DISCORD_ASK_MCP=0`.
  - `app-server` mode can't use that tool (one shared engine serves N threads, so
    per-exec env routing doesn't apply). Instead the bridge instructs Codex to
    **ask in plain prose and end the turn**; the human's reply continues the
    session (works with auto-queue). Codex's native `request_user_input` is *not*
    usable here — the engine gates it to `plan` collaboration mode, unavailable in
    the `default` mode work turns run in. In-thread buttons for app-server remain a
    future plan-mode-only enhancement.

---

## 8. Design principles (summary)

1. **One thread = one live engine.** Terminal and Discord are views of a
   bridge-owned app-server, never competing engines.
2. **Drop-in engines.** Every engine implements the same
   `runCodex(opts: CodexRunOptions): Promise<CodexRunResult>` contract; the
   daemon calls it as an injected dependency and stays engine-agnostic.
3. **Translate, don't special-case.** Normalize engine events into one internal
   exec-JSON shape; consumers written once.
4. **Form A parity.** Preserve live same-source: anything that would fork state
   between terminal and Discord is a regression.
5. **The answer is the focus.** Prose is primary; commands/reasoning/status
   recede (subtext, collapse, one-line).
6. **Fail safe & non-destructive.** Keep `exec` available; localhost-only;
   never send sensitive files (wechat); default to the least surprising option.
7. **Test the pure core + a gated real run.** Formatters and translators are
   pure and unit-tested (`node:test`); a gated real-model E2E
   (`npm run e2e:appserver`) covers the live path.

---

## 9. How to extend

- **Add a new engine** → implement the `runCodex` contract (`src/codex-runner.ts`
  is the type home) returning `{ codexThreadId, finalText, events }` and calling
  `onEvent` with exec-JSON events; if the engine speaks a different protocol,
  add a translator like `src/appserver-protocol.ts`. Wire selection in
  `bin/codex-discord.js` `start()` (the real entry point — **not** just
  `src/start.ts`, which only `npm start` uses).
- **Add / change rendering** → add a pure formatter in `src/discord-render.ts`
  (+ a `node:test`), then call it from `renderCodexEvent` /
  `noteForCodexEvent` in `src/discord-daemon.ts`. Keep the §6 weight ordering.
- **Surface a new Codex event** → translate it in `appserver-protocol.ts` into
  an exec-JSON shape, then render it.
- **Add a command** → the `!`-command handlers live in `src/discord-daemon.ts`.
- **Change engine defaults / config** → `src/config.ts` (`resolveRuntimeConfig`)
  is the single resolution point (env > config.json > default).

### Module map

| File | Responsibility |
| --- | --- |
| `bin/codex-discord.js` | CLI entry (`start`/`setup`/`status`/`resume`/`sessions`); **engine selection lives here** |
| `src/config.ts` | Config resolution (`CODEX_ENGINE`, ports, sandbox, allowlist) |
| `src/appserver-manager.ts` | Spawn/supervise `codex app-server`; shared client; free port; restart |
| `src/appserver-client.ts` | JSON-RPC client (request/notify, server-request routing) |
| `src/appserver-protocol.ts` | Translate app-server v2 notifications → exec-JSON events |
| `src/appserver-runner.ts` | Drop-in `runCodex` for app-server (thread/start → flush → turn/start) |
| `src/codex-runner.ts` | Drop-in `runCodex` for exec; the shared `CodexRunOptions`/`CodexRunResult` types |
| `src/discord-render.ts` | Pure Discord formatters (command line, prose, reasoning, status) |
| `src/discord-daemon.ts` | Gateway, commands, bindings, per-item rendering, ask-MCP wiring |
| `src/bindings.ts` | `discordThreadId ↔ codexThreadId` store |
| `src/codex-sessions.ts` | Local Codex session discovery (`!sessions`, resume) |
| `src/discord-ask-mcp.ts` | `ask_user_question` MCP server |

---

## 10. Verification

```sh
npm test                 # unit: translators, client, runner, config, render
npm run typecheck        # tsc --noEmit
npm run smoke            # exec-path handoff smoke (no regression check)
npm run e2e:appserver    # gated real-model E2E — needs a working `codex` login
```

Running instance is managed via the `codex-discord-service` wrapper (see
`docs/verification.md`): `restart` and check the banner for
`[engine] app-server live on ws://127.0.0.1:<port>`, `allow bot ids:`, and
`READY`.
