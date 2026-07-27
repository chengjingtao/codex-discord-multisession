# Discord readable rendering — design (form-A output parity with terminal)

Date: 2026-07-27
Status: approved (mock confirmed by user), pending implementation
Branch: `feat/discord-readable-rendering`

## Goal

Make Codex's Discord output read like the terminal: distinct visual treatment
per item type instead of one continuously-edited status blob. Approved
direction **C (hybrid)**, 1.5 s cadence, reasoning collapsed.

## Approved rendering (per turn)

- **Live status** — one lightweight message `⏳ Codex 运行中 (Ns) · \`!stop\` 中断`,
  edited at most every **1.5 s**; finalized to `✅ 完成 (Ns)` at turn end.
- **Reasoning** — collapsed spoiler `🧠 ||…||` (default hidden, click to reveal).
- **Command execution** — its own **embed** with a colored left bar:
  green (`exit 0`) / red (`exit ≠ 0`); title `⚡ <command>`; output in a
  ```text``` block (truncated); footer `exit N · X.Xs` (duration from
  app-server `durationMs` when present).
- **Agent prose** — a clean standalone markdown message prefixed `💬`.
- **Attach command** — unchanged.

## Architecture

Rendering lives in the **daemon** layer, driven by the translated exec-JSON
events both engines feed to `onEvent`. So exec and app-server both benefit;
reasoning collapsing mainly helps app-server (translator gains reasoning).

### Components
- `src/discord-render.ts` (new, pure/testable): `commandEmbed`,
  `reasoningSpoiler`, `agentProse`, `runningStatus`, color constants.
- `src/appserver-protocol.ts`: add `duration_ms` to the command-completed
  event; translate reasoning items (`item.completed` reasoning → exec-event
  `{type:'item.completed', item:{type:'reasoning', text}}`).
- `src/discord-daemon.ts`: `sendMessage`/`editMessage` gain an `embeds`
  option; `runCodexForThread` renders per item (embed / spoiler / prose) and
  keeps only a lightweight debounced status line; cadence 1200 → 1500 ms.

### Dedup rule
Agent messages render live as `💬` messages. The final `result.finalText`
equals the last agent message, so the end-of-turn `sendChunks(finalText)` is
dropped **when at least one agent message was rendered**; fallback to
`sendChunks(finalText)` when none was (keeps exec-only / empty-item turns
working).

## Non-goals
- Token-by-token prose streaming (Discord rate limits forbid it; the ⏳ status
  covers "working" feedback; prose renders on item completion — matches the
  approved mock).
- No change to command handling, bindings, or the app-server engine wiring.

## Testing
- Unit (node:test): `discord-render` formatters (embed color by exit, footer,
  truncation, spoiler, status text) and the translator additions (duration_ms,
  reasoning).
- Live: rebuild, restart daemon, drive a real `!codex`, confirm the new
  rendering (command embed colored by exit, reasoning spoiler, clean prose).
