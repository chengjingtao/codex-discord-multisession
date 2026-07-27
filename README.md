# Codex Discord Multisession

[![CI](https://github.com/ccuuu/codex-discord-multisession/actions/workflows/ci.yml/badge.svg)](https://github.com/ccuuu/codex-discord-multisession/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/codex-discord-multisession)](https://www.npmjs.com/package/codex-discord-multisession)
[![License](https://img.shields.io/github/license/ccuuu/codex-discord-multisession)](./LICENSE)

Discord bridge for Codex CLI. It is the Codex-shaped equivalent of
`claude-discord-multisession`: each Discord thread maps to one persistent Codex
`thread_id`, and follow-up Discord messages continue that Codex session.
The same package also includes a local-only `codex-wechat` bridge for the
previously built `wx` personal WeChat CLI.

By default the bridge runs the **`app-server` engine**, giving **form A — live
same-source**: a terminal Codex session and its bound Discord thread are the
*same live session*, so you can speak from either side and see turns stream in
real time. Attach a terminal with `codex resume <threadId> --remote ws://…`.
An `exec` engine (one `codex exec` per message, turn-taking handoff) is still
available via `CODEX_ENGINE=exec`.

> **Read [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) before extending the
> bridge** — it is the living reference for capabilities and design principles.
> Promotion copy lives in [docs/promo-copy.md](./docs/promo-copy.md).

## Quick Start

### Discord

Prerequisites:

- Node.js 20+
- A working local `codex` CLI
- A Discord server where you can create a bot and use threads

1. Clone the repository and install dependencies:

   ```sh
   git clone git@github.com:ccuuu/codex-discord-multisession.git
   cd codex-discord-multisession
   npm install
   npm run build
   ```

2. Create a Discord bot, enable `Message Content Intent`, invite it to your
   server, and copy:

   - the bot token
   - the parent channel ID where new Codex threads should be created

3. Start the bridge:

   ```sh
   export DISCORD_BOT_TOKEN='<bot token>'
   export CODEX_DISCORD_PARENT_CHANNEL_ID='<parent channel id>'
   export CODEX_DISCORD_WORKDIR="$HOME/some/project"
   node bin/codex-discord.js start
   ```

4. In that Discord parent channel, send:

   ```text
   !codex Summarize this repository and tell me the next step.
   ```

5. The bot creates a thread and binds it to one persistent Codex session.

6. Continue in the thread with normal messages, or use:

   ```text
   !status
   !queue <message>
   !stop
   ```

### Resume an Existing Local Codex Session

If you already started Codex in a terminal and want Discord to continue the
same conversation:

```text
!codex-resume --last my-local-session
```

Or, inside an existing Discord thread:

```text
!resume --last
```

### Optional WeChat Add-On

`codex-wechat` depends on a local `wx` command from `wx-ilink-cli`. The most
practical setup is to clone `wx-ilink-cli` and run `npm run link:wx` first:

```sh
git clone git@github.com:ccuuu/wx-ilink-cli.git
cd wx-ilink-cli
nvm use
npm install
npm run build
npm run link:wx
wx --help
```

Then you can bridge the same Codex workflow into personal WeChat:

```sh
node bin/codex-wechat.js doctor
node bin/codex-wechat.js start
```

Then send:

```text
!codex summarize this repository
```

## What is verified

Verified on Codex CLI `0.145.0` (app-server engine) and `0.130.0+` (exec
engine):

1. **app-server**: `codex app-server` hosts N threads over JSON-RPC; multiple
   clients that `thread/resume` the same persisted thread receive every turn's
   events live (form A), and `codex resume --remote` attaches a terminal to the
   bridge's app-server. `thread/inject_items` flushes the rollout so attach
   works immediately.
2. **exec**: `codex exec --json` emits `thread.started`; `codex exec resume
   --json <thread_id>` continues the same conversation.
3. A local binding store maps `discordThreadId -> codexThreadId`.

Run the smoke test:

```sh
npm install
npm run smoke
```

Expected output:

```json
{
  "ok": true,
  "discordThreadId": "fake-discord-thread-1",
  "codexThreadId": "...",
  "first": "codex-discord-bridge-ok",
  "second": "codex-discord-bridge-ok"
}
```

## Current MVP

The CLI implements Discord-first and local-first handoff workflows:

- In the configured parent channel, send `!codex <task>`.
- The bot creates a public thread under that parent channel.
- The first prompt starts `codex exec --json`.
- Later messages in that Discord thread call `codex exec resume --json
  <codexThreadId>`.
- If you already started Codex locally, resume that existing session from
  Discord with `!codex-resume <session-id>` or `!codex-resume --last`.
- Bindings are stored in `~/.codex/channels/discord/bindings.json` by
  default.
- Discord-driven Codex turns get an auto-injected MCP tool named
  `ask_user_question`, so Codex can ask the human for a choice or free-form
  answer through Discord buttons, select menus, and modals before continuing
  the same turn.

Thread control commands:

| Command | Effect |
| --- | --- |
| `!resume [session-id\|--last] [workdir]` | With a session id or `--last`, resume an existing local Codex session in the current Discord thread. If `workdir` is omitted, the bridge uses the session's recorded cwd. With no arguments, resume Discord-driven Codex turns after `!pause`. |
| `!codex-resume <session-id\|--last> [--cwd path] [thread name]` | Create a new Discord thread in the parent channel and resume an existing local Codex session there. `--cwd` overrides the session's recorded cwd. |
| `!sessions [--limit 20] [--query text] [--cwd path]` | List recent local Codex sessions from Discord. The Discord command is capped at 50 rows. |
| `!attach` | Print a local terminal command, e.g. `cd <workdir> && codex resume <session>`, so you can continue the same Codex session in a visible terminal. |
| `!queue <message>` | Queue a follow-up message to run after the current Codex turn. If no turn is running, it starts immediately. |
| `!stop` | Interrupt the currently running Codex turn in this Discord thread, update the live status, and post a final stop result when Codex exits. Aliases: `!cancel`, `!interrupt`. |
| `!pause` | Optional: pause Discord-driven Codex turns for this thread while you work locally. |
| `!status` | Show bound Codex session, workdir, current mode, queued count, and the current live status snapshot when a turn is running. |

Under the default **`app-server` engine**, Discord and the terminal attach to
the *same live Codex session*: `!attach` prints a `codex resume <threadId>
--remote ws://…` command, and turns driven from either side stream to both in
real time. Under `CODEX_ENGINE=exec` the same `!attach` prints a local
`cd <workdir> && codex resume <session>` handoff instead (turn-taking, no live
mirror). Either way the bridge allows only one Codex turn per Discord thread at
a time. While a turn runs, a lightweight `⏳` status line updates (~1.5 s
cadence) and each item renders on its own: agent prose as clean markdown,
commands as muted `-# ✓/✗` subtext lines (output shown only on failure),
reasoning as a collapsed spoiler. A normal message sent during a running turn
is not queued automatically; the bridge replies with the current status
snapshot. Wait and resend after completion, use `!queue <message>`, or `!stop`.

### Interactive Questions

The Discord bridge includes a local MCP server, `codex-discord-mcp`, that is
configured automatically for Codex processes launched by the bridge. No global
`codex mcp add` step is required for the Discord path.

When Codex needs clarification, a choice, or missing input, the bridge asks it
to call:

```text
ask_user_question
```

The tool posts the question into the current Discord thread and waits for the
answer:

- up to five single-choice options render as buttons;
- longer option lists and multi-select questions render as select menus;
- free-form answers use an `Answer...` / `Other...` modal;
- up to four questions can be asked in one tool call.

Example model-visible use case:

```text
Ask the user whether to run full tests or only typecheck before continuing.
```

Expected Discord flow:

1. Codex calls `ask_user_question`.
2. The bot posts the choices in the same thread.
3. The user clicks a button or submits the modal.
4. The answer is returned to Codex and the current turn continues.

This is the Codex equivalent of Claude's `AskUserQuestion` workflow, but it is
implemented as an MCP tool rather than a native Codex channel hook. It works
for Codex turns launched by `codex-discord`; local terminal sessions opened via
`!attach` do not inherit the Discord ask context.

## Local-First Handoff

Use this when you started a Codex TUI locally first and later want Discord to
continue the same conversation.

1. Start Codex locally in the project directory:

   ```sh
   cd "$HOME/some/project"
   codex
   ```

2. In the configured Discord parent channel, create a thread for that session:

   ```text
   !codex-resume --last my-local-session
   ```

   `--last` resolves to the newest recorded Codex session under the bridge's
   session homes, and the bridge uses that session's recorded cwd by default.
   If you have the exact Codex session id, prefer the explicit form:

   ```text
   !codex-resume <codex-session-id> my-local-session
   ```

   If the session metadata cannot be found, or you intentionally want a
   different working directory, pass it explicitly:

   ```text
   !codex-resume <codex-session-id> --cwd /Users/me/some/project my-local-session
   ```

3. Continue in the created Discord thread:

   ```text
   Summarize what we have done so far and continue with the next step.
   ```

If you manually created a Discord thread already, send this inside that thread:

```text
!resume --last
!resume <codex-session-id> /Users/me/some/project
```

If the session is not the newest one, list recent local Codex sessions:

```text
!sessions
!sessions --limit 10 --query pipeline
!sessions --cwd ~/some/project
```

Or list them locally:

```sh
codex-discord sessions
```

Useful filters:

```sh
codex-discord sessions --limit 50
codex-discord sessions --query pipeline
codex-discord sessions --cwd "$HOME/some/project"
codex-discord sessions --json
```

Copy the session id from the output and resume it:

```text
!codex-resume <codex-session-id> my-local-session
```

You can also resume an existing session into a known Discord thread from the
CLI:

```sh
codex-discord resume \
  --thread '<discord thread snowflake>' \
  --session '<codex session id or --last>'
```

The CLI also uses the session's recorded cwd by default. Add
`--workdir "$HOME/some/project"` only when you want to override it or the
session metadata is not available.

Session lookup scans `CODEX_HOME`, every path in `CODEX_SESSION_HOMES`,
and `~/.codex`. When a resumed session is found, the bridge stores the
matching Codex home and uses it for future `codex exec resume` calls. This
matters when a local TUI was started by a wrapper that writes sessions outside
`~/.codex`.

## Setup

Primary path for this repository is local checkout:

```sh
git clone git@github.com:ccuuu/codex-discord-multisession.git
cd codex-discord-multisession
npm install
npm run build
node bin/codex-discord.js help
node bin/codex-wechat.js help
```

If you want global commands on your own machine, link the checkout:

```sh
npm run link:cli
codex-discord help
codex-wechat help
```

An npm package also exists, but it is optional and not the recommended entry
point for early adopters:

```sh
npm install -g codex-discord-multisession
```

Create a Discord Application and Bot, enable Message Content Intent, and
invite the bot with at least:

- View Channels
- Send Messages
- Send Messages in Threads
- Create Public Threads
- Read Message History

Start the bridge:

```sh
node bin/codex-discord.js start
```

On a TTY, `start` opens an interactive prompt for all startup values. Existing
environment variables and saved config are used only as defaults, so you can
press Enter to accept or type a replacement for the current run. The bot token
prompt is hidden and the token is never saved.

Run without prompts for automation:

```sh
codex-discord start --yes
```

You can still write non-secret local config separately:

```sh
codex-discord setup
```

Equivalent non-interactive form:

```sh
codex-discord setup \
  --parent '<channel snowflake>' \
  --workdir "$HOME/some/project" \
  --proxy 'http://127.0.0.1:7897'
```

`setup` writes `~/.codex/channels/discord/config.json`. It does not write the
bot token. You may provide the token through the environment, or enter it at
the hidden `start` prompt:

```sh
export DISCORD_BOT_TOKEN='<bot token>'
codex-discord start
```

You can inspect resolved non-secret config:

```sh
codex-discord status
```

Do not commit `.env` or tokens. `.env` is ignored by this repo.

Optional:

```sh
export CODEX_ENGINE='app-server'                 # default; set 'exec' to fall back
export CODEX_DISCORD_APP_SERVER_PORT='0'          # 0 = pick a free localhost port
export CODEX_DISCORD_APP_SERVER_TOKEN_ENV='CODEX_APP_SERVER_TOKEN'  # optional bearer-token env name
export CODEX_DISCORD_ALLOW_BOT_IDS='<bot id>,<bot id>'  # bot authors allowed to trigger !codex
export CODEX_MODEL='gpt-5.5'
export CODEX_SANDBOX='workspace-write'
export CODEX_DISCORD_SANDBOX='workspace-write'
export CODEX_DISCORD_PARENT_CHANNEL_ID='<override channel snowflake>'
export CODEX_DISCORD_WORKDIR="$HOME/some/project"
export CODEX_DISCORD_PROXY='http://127.0.0.1:7897'
export CODEX_DISCORD_STATE_DIR="$HOME/.codex/channels/discord"
export CODEX_DISCORD_ASK_MCP='1'
export CODEX_BIN='codex'
export CODEX_HOME="$HOME/.codex"
export CODEX_SESSION_HOMES="$HOME/.config/codex-alt"
```

The `app-server` engine requires Codex ≥ 0.145 (with `codex app-server`). The
bridge spawns and supervises one app-server bound to `127.0.0.1`; each Discord
thread is one Codex thread on it, and `!attach` prints the `codex resume
<threadId> --remote ws://127.0.0.1:<port>` command to join the same live
session from a terminal. See [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md).

`npm run start` uses the same Discord bridge and interactive startup prompt
during local development. Set `CODEX_DISCORD_NO_PROMPT=1` or pass `--yes` to
`codex-discord start` when prompts should be disabled.

By default the bridge starts Codex with `codex`. Use `CODEX_BIN` or
`codex-discord setup --codex-bin <name>` to force a specific binary, for
example a real executable wrapper named `codex-team`.
`CODEX_BIN` must point to an executable file in `PATH` or an absolute path;
shell aliases such as `alias codex-team=...` are not visible to the bridge.
The default Codex sandbox is `workspace-write`. Override with
`CODEX_SANDBOX`, `CODEX_DISCORD_SANDBOX`, or
`codex-discord setup --sandbox <mode>` only when needed. `CODEX_SANDBOX` takes
precedence over `CODEX_DISCORD_SANDBOX`.
Set `CODEX_DISCORD_ASK_MCP=0` to disable the auto-injected
`ask_user_question` MCP tool.

## Personal WeChat Local Bridge

`codex-wechat` is a local experimental bridge for the `wx` CLI, not an
official WeChat bot integration. It requires the local `wx` command to exist
and scans a QR code whenever the bridge process starts. WeChat login
credentials are not persisted.

The transport is simple:

- Incoming messages are read from `wx bridge --resume --json`.
- Replies are sent by writing JSON-line send commands to the same `wx bridge`
  process.
- Images, files, videos, and voice messages are downloaded by `wx` under
  `~/.wx-ilink-cli/media/` when possible.
- Image attachments are passed to Codex with `codex exec --image`.
- Non-image attachments are included in the Codex prompt as local file paths.
- Files changed or generated by Codex are detected after each turn and sent
  back to WeChat when they are small enough. Sensitive-looking files such as
  `.env`, private keys, certificates, and kubeconfigs are never sent.
- Codex image-generation outputs under
  `$CODEX_HOME/generated_images/<codex-session-id>/` and other configured
  session homes are also detected and sent back as image messages.
- One WeChat peer maps to one Codex session.
- `!codex`, `!resume`, `!sessions`, `!queue`, `!stop`, `!status`, `!attach`,
  and `!pause` are supported.
- Progress is quiet by default: no start message and no automatic event stream.
  If a turn runs longer than two minutes, WeChat gets one reminder with
  `!status` / `!stop` / `!queue` hints. After that, no more automatic progress
  messages are sent until the final result.

Recommended promotion flow:

```sh
git clone git@github.com:ccuuu/codex-discord-multisession.git
cd codex-discord-multisession
npm install
npm run build
npm run link:cli
codex-wechat doctor
codex-wechat start
```

Before this flow, install the local `wx` command from `wx-ilink-cli` and make
sure `npm run link:wx` has exposed `wx` in your PATH:

```sh
git clone git@github.com:ccuuu/wx-ilink-cli.git
cd wx-ilink-cli
nvm use
npm install
npm run build
npm run link:wx
wx --help
```

`codex-wechat start` starts `wx bridge --resume --json`, which launches the QR
login flow for that bridge process. You can also run a one-shot QR login check:

```sh
codex-wechat login
codex-wechat login --fresh
```

For local development from this checkout:

```sh
npm run build
node bin/codex-wechat.js doctor
node bin/codex-wechat.js start
```

Optional non-secret setup:

```sh
codex-wechat setup
codex-wechat start
```

Run without prompts:

```sh
export CODEX_WECHAT_WX_BIN='wx'
export CODEX_WECHAT_WORKDIR="$HOME/some/project"
codex-wechat start --yes
```

Then send one of these in WeChat:

```text
!codex summarize this repository
!resume --last
!sessions --limit 10
```

`!codex <task>` always starts a new Codex session in the configured
`CODEX_WECHAT_WORKDIR` / setup workdir. Plain follow-up messages continue the
currently bound session and therefore use that session's stored workdir.

Useful environment variables:

```sh
export CODEX_WECHAT_WX_BIN='wx'
export CODEX_WECHAT_WORKDIR="$HOME/some/project"
export CODEX_WECHAT_STATE_DIR="$HOME/.codex/channels/wechat"
export CODEX_WECHAT_SANDBOX='workspace-write'
export CODEX_WECHAT_SEND_ARTIFACTS='1'
export CODEX_WECHAT_ARTIFACT_MAX_FILES='5'
export CODEX_WECHAT_ARTIFACT_MAX_BYTES='10485760'
export CODEX_BIN='codex'
export CODEX_MODEL='gpt-5.5'
export CODEX_HOME="$HOME/.codex"
export CODEX_SESSION_HOMES="$HOME/.config/codex-alt"
```

Artifact auto-send uses Git status when the Codex workdir is inside a Git
repository. Outside Git, it falls back to a bounded filesystem snapshot that
skips heavy generated directories such as `node_modules`, `dist`, and `build`.
Set `CODEX_WECHAT_SEND_ARTIFACTS=0` to disable this behavior.
Generated images saved under `$CODEX_HOME/generated_images/<session-id>/` or
another configured session home are handled separately because they are outside
the Codex workdir.

Local development:

```sh
npm run start:wechat
npm run smoke:wechat
```

This path is useful for personal local experiments and depends on a local
interactive WeChat login through `wx`.

Development commands:

```sh
npm run build
npm run typecheck
npm run start
npm run start:proxy
npm run smoke
npm run start:wechat
npm run smoke:wechat
```

## Differences From Claude Version

The Claude plugin uses Claude Code channel APIs:

- `notifications/claude/channel`
- `notifications/claude/channel/permission`
- `PreToolUse` hook for `AskUserQuestion`
- `.claude-plugin/plugin.json`

Codex does not expose those exact channel APIs. This bridge uses Codex's own
runtime as the control plane instead:

- Control plane (default): `codex app-server` — the bridge is a JSON-RPC client
  driving `thread/start` / `turn/start` and reading the event stream; a terminal
  joins the same live thread with `codex resume --remote` (form A). Fallback:
  `codex exec --json` / `codex exec resume --json <thread_id>`.
- Output parsing: app-server v2 notifications translated to exec-JSON events
  (one internal shape; see [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) §4).
- State: local bindings file.
- Interactive questions: auto-injected local MCP tool `ask_user_question`,
  routed through the bridge's local ask socket and Discord message components.

The `AskUserQuestion` equivalent is implemented as a Codex MCP tool, not as a
native runtime hook. Codex must choose to call `ask_user_question`; the bridge
adds a short instruction to each Discord-driven turn to encourage that behavior.
Native permission prompt routing is still separate work.

## Next Work

Done since the original MVP: app-server engine (form A live same-source),
bot-author allowlist, `!codex --cwd/--name`, and readable per-item rendering
(lightweight command lines, collapsed reasoning, clean prose). See
[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md).

Open:

- Guild/channel policy beyond the bot-author allowlist.
- Native permission-approval routing (transport via `onServerRequest` exists;
  Discord ✅/❌ reaction surface is not wired yet).
- Mid-turn `turn/steer` (currently messages during a turn use `!queue`).
- Attachment download/upload handling.
- Package as a Codex plugin once the runtime contract is stable.
