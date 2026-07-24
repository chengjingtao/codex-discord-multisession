# Verification Notes

Date: 2026-05-15

## Local Codex Capability Probe

Version:

```sh
codex --version
# codex-cli 0.130.0
```

Start a new non-interactive session:

```sh
codex exec --json --sandbox read-only --skip-git-repo-check -C /tmp \
  'Reply with exactly: codex-discord-smoke-ok'
```

Observed JSONL:

```json
{"type":"thread.started","thread_id":"019e2b2d-43cb-7b10-97b2-d233be90f37f"}
{"type":"item.completed","item":{"type":"agent_message","text":"codex-discord-smoke-ok"}}
```

Resume the same session:

```sh
codex exec resume --json --skip-git-repo-check \
  019e2b2d-43cb-7b10-97b2-d233be90f37f \
  'What exact phrase did I ask you to reply with in the previous turn? Reply only with that phrase.'
```

Observed final answer:

```text
codex-discord-smoke-ok
```

## Prototype Smoke Test

Command:

```sh
npm run smoke
```

Result:

```json
{
  "ok": true,
  "discordThreadId": "fake-discord-thread-1",
  "codexThreadId": "019e2b43-1238-74c1-9f32-f47e6bbae9e1",
  "first": "codex-discord-bridge-ok",
  "second": "codex-discord-bridge-ok"
}
```

This verifies the core bridge invariant: one Discord thread can be mapped to
one Codex session and resumed later.

---

## app-server engine (form A: live same-source) — 2026-07-24

Verified on `codex-cli 0.145.0`. The `app-server` engine drives Codex through a
persistent `codex app-server` instead of one-shot `codex exec`, so a terminal
session and its bound Discord thread are the **same live session**.

### Enable

```sh
export CODEX_ENGINE=app-server
# optional: pin the port (default: an ephemeral free port)
export CODEX_DISCORD_APP_SERVER_PORT=8931
# optional: require a bearer token on the ws endpoint
export CODEX_DISCORD_APP_SERVER_TOKEN_ENV=CODEX_APP_SERVER_TOKEN
npm run build && node dist/start.js   # or: npm start
```

On startup the bridge logs `[engine] app-server live on ws://127.0.0.1:<port>`.

### Flow

1. In the Discord parent channel: `!codex [--cwd <path>] [--name <n>] [prompt]`.
   The bridge opens a Codex thread, flushes its rollout to disk (via
   `thread/inject_items`, no model call), and posts a **terminal attach** line.
2. Join from a terminal — same live thread, speak from either side:

   ```sh
   codex resume <threadId> --remote ws://127.0.0.1:<port>
   # with a token: append --remote-auth-token-env CODEX_DISCORD_APP_SERVER_TOKEN_ENV
   ```
3. `!attach` re-prints the attach command for an already-bound thread.

### Automated checks

```sh
npm test                 # unit tests (protocol translation, client, runner, config)
npm run e2e:appserver    # gated real-model E2E — needs a working `codex` login
```

Expected E2E line:

```
E2E OK thread=<uuid> first="PONG" second="AGAIN" rollout=persisted
```

This confirms: app-server spawns, a new session runs and returns model text,
the rollout persists (so terminal `resume --remote` can attach), and resuming
the same `threadId` continues the same session.
