# Codex app-server engine mode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `app-server` engine to the Codex Discord bridge so a terminal `codex` session and its bound Discord thread are one live session (bidirectional real-time mirror), selectable via `CODEX_ENGINE` alongside the existing `exec` default.

**Architecture:** The bridge spawns and supervises one persistent `codex app-server --listen ws://127.0.0.1:PORT` (single live engine, N threads). A drop-in runner (`runCodexViaAppServer`) with the **same `CodexRunOptions → CodexRunResult` signature** as the current `runCodex` drives turns over JSON-RPC and **translates app-server v2 notifications into the exec-JSON event shapes** the daemon already formats — so `discord-daemon.ts` needs only runner selection + an attach-command string. The terminal joins with `codex resume <threadId> --remote ws://127.0.0.1:PORT`.

**Tech Stack:** Node ≥20 (ESM, `NodeNext`), TypeScript 5.8 (strict), `ws` 8, `tsx` for run/test, built-in `node:test`. No new runtime deps.

## Global Constraints

- Node `>=20`; TypeScript `strict: true`, `module`/`moduleResolution: NodeNext`. Relative imports MUST use `.js` extensions (compiled ESM).
- Do NOT change existing `exec` behaviour; `CODEX_ENGINE` defaults to `exec`.
- No new runtime dependencies (reuse `ws`, already a dep). Tests use `node:test` via `tsx`, no new framework.
- app-server binds `127.0.0.1` only; never expose beyond localhost. Optional bearer token via env.
- Reuse existing modules verbatim where the table in the spec says "reuse": `bindings.ts`, `config.ts` (extend), `codex-sessions.ts`, `discord-ask-mcp.ts`, `discord-daemon.ts` (minimal edits only).
- The runner contract is fixed by `src/codex-runner.ts`: `runCodex(opts: CodexRunOptions): Promise<CodexRunResult>` where `CodexRunResult = { codexThreadId: string; finalText: string; events: unknown[] }` and `opts.onEvent(event)` receives **exec-JSON** events. The new runner MUST match this exactly and MUST throw `CodexRunInterruptedError` on interrupt.
- Exec-JSON event contract consumed by the daemon (`src/discord-daemon.ts:337-371` and `src/codex-runner.ts:114-117`):
  - `{ type: 'thread.started', thread_id: string }`
  - `{ type: 'turn.started' }`, `{ type: 'turn.completed' }`
  - `{ type: 'item.started', item: { type: 'command_execution', command: string } }`
  - `{ type: 'item.completed', item: { type: 'command_execution', command: string, exit_code: number|null, aggregated_output: string } }`
  - `{ type: 'item.completed', item: { type: 'agent_message', text: string } }`

---

## Verified facts (from spikes, codex 0.145.0) the plan relies on

- app-server v2 notification → item shapes: `agentMessage { id, text }`; `commandExecution { id, command, aggregatedOutput: string|null, exitCode: number|null, status }`; `thread/started { thread: { id } }`; deltas `item/agentMessage/delta { delta }`.
- `thread/start` does NOT flush rollout; `thread/inject_items` (no model call) DOES → required before terminal `resume`.
- `turn/start` params accept `approvalPolicy` (`untrusted|on-request|never`), `sandbox` (`read-only|workspace-write|danger-full-access`), `input: [{type:'text', text}]`.
- Multi-client `thread/resume` on a persisted thread mirrors every turn's events bidirectionally.

---

## File structure

- Create `src/appserver-protocol.ts` — types + the pure notification→exec-JSON translator.
- Create `src/appserver-client.ts` — ws JSON-RPC client (framing, initialize, request/notify, notification & server-request handlers).
- Create `src/appserver-manager.ts` — spawn/supervise `codex app-server --listen`, readiness, shared client, `remoteUrl()`.
- Create `src/appserver-runner.ts` — `runCodexViaAppServer(opts): Promise<CodexRunResult>` (drop-in).
- Modify `src/config.ts` — add `engine`, `appServerPort`, `appServerTokenEnv` to `BridgeConfig` + `resolveRuntimeConfig`.
- Modify `src/discord-daemon.ts` — select runner by engine; add `remoteAttachCommand` to `!codex` landing + `!attach`.
- Modify `src/start.ts` / `src/start-options.ts` — construct manager+runner when engine is `app-server`.
- Create `test/appserver-protocol.test.ts`, `test/appserver-client.test.ts`, `test/appserver-runner.test.ts`.
- Modify `package.json` — add `"test": "tsx --test test/*.test.ts"`.
- Modify `docs/verification.md` — add app-server manual E2E steps.

---

## Task 1: Config — engine selector + app-server settings

**Files:**
- Modify: `src/config.ts`
- Test: `test/config.test.ts` (Create)

**Interfaces:**
- Produces: `BridgeConfig.engine?: 'exec' | 'app-server'`, `BridgeConfig.appServerPort?: number`, `BridgeConfig.appServerTokenEnv?: string`; `resolveRuntimeConfig` returns those with `engine` defaulted to `'exec'`, `appServerPort` to `0` (meaning "pick a free port").

- [ ] **Step 1: Write the failing test** — `test/config.test.ts`

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveRuntimeConfig } from '../src/config.js'

test('engine defaults to exec', () => {
  const r = resolveRuntimeConfig({})
  assert.equal(r.engine, 'exec')
})

test('engine + port come from env over config', () => {
  process.env.CODEX_ENGINE = 'app-server'
  process.env.CODEX_DISCORD_APP_SERVER_PORT = '8931'
  const r = resolveRuntimeConfig({ engine: 'exec', appServerPort: 1 })
  assert.equal(r.engine, 'app-server')
  assert.equal(r.appServerPort, 8931)
  delete process.env.CODEX_ENGINE
  delete process.env.CODEX_DISCORD_APP_SERVER_PORT
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test test/config.test.ts`
Expected: FAIL (`r.engine` is `undefined`).

- [ ] **Step 3: Implement** — in `src/config.ts`

Add to `BridgeConfig`:
```ts
  engine?: 'exec' | 'app-server'
  appServerPort?: number
  appServerTokenEnv?: string
```
Add to the object returned by `resolveRuntimeConfig`:
```ts
    engine: (process.env.CODEX_ENGINE as 'exec' | 'app-server' | undefined) ?? config.engine ?? 'exec',
    appServerPort: Number(process.env.CODEX_DISCORD_APP_SERVER_PORT ?? config.appServerPort ?? 0) || 0,
    appServerTokenEnv: process.env.CODEX_DISCORD_APP_SERVER_TOKEN_ENV ?? config.appServerTokenEnv,
```
And widen the return type: add `engine: 'exec' | 'app-server'; appServerPort: number` to the `Required<Pick<...>>` intersection.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test test/config.test.ts` — Expected: PASS. Then `npm run typecheck` — Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts test/config.test.ts
git commit -m "feat(config): add CODEX_ENGINE selector and app-server settings"
```

---

## Task 2: Protocol translator (pure)

**Files:**
- Create: `src/appserver-protocol.ts`
- Test: `test/appserver-protocol.test.ts`

**Interfaces:**
- Produces:
  - `type ExecEvent = Record<string, unknown>`
  - `function translateNotification(method: string, params: any): ExecEvent[]` — maps ONE app-server v2 notification to zero-or-more exec-JSON events.
  - `function agentTextOf(ev: ExecEvent): string | undefined` — returns text when `ev` is a completed agent_message (for finalText accumulation).

- [ ] **Step 1: Write the failing test** — `test/appserver-protocol.test.ts`

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { translateNotification, agentTextOf } from '../src/appserver-protocol.js'

test('thread/started → thread.started with thread_id', () => {
  const out = translateNotification('thread/started', { thread: { id: 'T1' } })
  assert.deepEqual(out, [{ type: 'thread.started', thread_id: 'T1' }])
})

test('turn started/completed map through', () => {
  assert.deepEqual(translateNotification('turn/started', {}), [{ type: 'turn.started' }])
  assert.deepEqual(translateNotification('turn/completed', {}), [{ type: 'turn.completed' }])
})

test('commandExecution started → item.started command_execution', () => {
  const out = translateNotification('item/started', { item: { type: 'commandExecution', command: 'echo hi' } })
  assert.deepEqual(out, [{ type: 'item.started', item: { type: 'command_execution', command: 'echo hi' } }])
})

test('commandExecution completed → renamed fields', () => {
  const out = translateNotification('item/completed', {
    item: { type: 'commandExecution', command: 'echo hi', exitCode: 0, aggregatedOutput: 'hi\n' },
  })
  assert.deepEqual(out, [{ type: 'item.completed', item: { type: 'command_execution', command: 'echo hi', exit_code: 0, aggregated_output: 'hi\n' } }])
})

test('agentMessage completed → agent_message + agentTextOf', () => {
  const out = translateNotification('item/completed', { item: { type: 'agentMessage', text: 'DONE' } })
  assert.deepEqual(out, [{ type: 'item.completed', item: { type: 'agent_message', text: 'DONE' } }])
  assert.equal(agentTextOf(out[0]), 'DONE')
})

test('unrelated notifications translate to nothing', () => {
  assert.deepEqual(translateNotification('item/agentMessage/delta', { delta: 'x' }), [])
  assert.deepEqual(translateNotification('item/started', { item: { type: 'reasoning' } }), [])
})
```

- [ ] **Step 2: Run test to verify it fails** — `npx tsx --test test/appserver-protocol.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement** — `src/appserver-protocol.ts`

```ts
export type ExecEvent = Record<string, unknown>

export function translateNotification(method: string, params: any): ExecEvent[] {
  switch (method) {
    case 'thread/started': {
      const id = params?.thread?.id
      return typeof id === 'string' ? [{ type: 'thread.started', thread_id: id }] : []
    }
    case 'turn/started':
      return [{ type: 'turn.started' }]
    case 'turn/completed':
      return [{ type: 'turn.completed' }]
    case 'item/started': {
      const item = params?.item
      if (item?.type === 'commandExecution') {
        return [{ type: 'item.started', item: { type: 'command_execution', command: String(item.command ?? '') } }]
      }
      return []
    }
    case 'item/completed': {
      const item = params?.item
      if (item?.type === 'commandExecution') {
        return [{ type: 'item.completed', item: {
          type: 'command_execution',
          command: String(item.command ?? ''),
          exit_code: item.exitCode ?? null,
          aggregated_output: typeof item.aggregatedOutput === 'string' ? item.aggregatedOutput : '',
        } }]
      }
      if (item?.type === 'agentMessage') {
        return [{ type: 'item.completed', item: { type: 'agent_message', text: String(item.text ?? '') } }]
      }
      return []
    }
    default:
      return []
  }
}

export function agentTextOf(ev: ExecEvent): string | undefined {
  const item = (ev as any).item
  if (ev.type === 'item.completed' && item?.type === 'agent_message' && typeof item.text === 'string') return item.text
  return undefined
}
```

- [ ] **Step 4: Run test to verify it passes** — `npx tsx --test test/appserver-protocol.test.ts` → PASS. `npm run typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/appserver-protocol.ts test/appserver-protocol.test.ts
git commit -m "feat(appserver): pure notification→exec-JSON translator"
```

---

## Task 3: app-server JSON-RPC client

**Files:**
- Create: `src/appserver-client.ts`
- Test: `test/appserver-client.test.ts`

**Interfaces:**
- Consumes: `ws` package.
- Produces:
  - `type ServerRequestHandler = (method: string, params: any) => Promise<any>`
  - `class AppServerClient { constructor(url: string, opts?: { token?: string }); connect(): Promise<void>; initialize(clientInfo?: {name:string;version:string}): Promise<void>; request<T=any>(method: string, params: any): Promise<T>; notify(method: string, params: any): void; onNotification(fn: (method: string, params: any) => void): void; onServerRequest(fn: ServerRequestHandler): void; close(): void }`
  - Correlates responses by numeric `id`; server→client requests (they carry `id` + `method`) are routed to the `onServerRequest` handler and its resolved value is sent back as `{ id, result }`.

- [ ] **Step 1: Write the failing test** — `test/appserver-client.test.ts` (drives the client against a real in-process `ws` server)

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WebSocketServer } from 'ws'
import { AppServerClient } from '../src/appserver-client.js'

function fakeServer(handler: (msg: any, send: (o: any) => void) => void) {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  wss.on('connection', ws => {
    ws.on('message', raw => handler(JSON.parse(String(raw)), o => ws.send(JSON.stringify(o))))
  })
  return new Promise<{ url: string; close: () => void }>(res => {
    wss.on('listening', () => {
      const { port } = wss.address() as any
      res({ url: `ws://127.0.0.1:${port}`, close: () => wss.close() })
    })
  })
}

test('request correlates by id', async () => {
  const srv = await fakeServer((msg, send) => {
    if (msg.method === 'ping') send({ id: msg.id, result: { pong: true } })
  })
  const c = new AppServerClient(srv.url)
  await c.connect()
  const r = await c.request('ping', {})
  assert.deepEqual(r, { pong: true })
  c.close(); srv.close()
})

test('notifications reach onNotification', async () => {
  const srv = await fakeServer((msg, send) => {
    if (msg.method === 'go') { send({ id: msg.id, result: {} }); send({ method: 'turn/started', params: {} }) }
  })
  const c = new AppServerClient(srv.url)
  await c.connect()
  const seen: string[] = []
  c.onNotification(m => seen.push(m))
  await c.request('go', {})
  await new Promise(r => setTimeout(r, 50))
  assert.ok(seen.includes('turn/started'))
  c.close(); srv.close()
})

test('server→client request is answered via onServerRequest', async () => {
  let answer: any
  const srv = await fakeServer((msg, send) => {
    if (msg.method === 'kick') { send({ id: 99, method: 'item/permissions/requestApproval', params: { approvalId: 'a1' } }) }
    if (msg.id === 99 && msg.result) { answer = msg.result; }
  })
  const c = new AppServerClient(srv.url)
  await c.connect()
  c.onServerRequest(async (method, params) => ({ decision: 'approved', for: params.approvalId }))
  c.notify('kick', {})
  await new Promise(r => setTimeout(r, 80))
  assert.deepEqual(answer, { decision: 'approved', for: 'a1' })
  c.close(); srv.close()
})
```

- [ ] **Step 2: Run test to verify it fails** — `npx tsx --test test/appserver-client.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement** — `src/appserver-client.ts`

```ts
import WebSocket from 'ws'

export type ServerRequestHandler = (method: string, params: any) => Promise<any>

export class AppServerClient {
  private ws?: WebSocket
  private nextId = 1
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>()
  private notifyHandlers: Array<(method: string, params: any) => void> = []
  private serverRequestHandler?: ServerRequestHandler

  constructor(private url: string, private opts: { token?: string } = {}) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const headers = this.opts.token ? { Authorization: `Bearer ${this.opts.token}` } : undefined
      this.ws = new WebSocket(this.url, { headers })
      this.ws.on('open', () => resolve())
      this.ws.on('error', err => reject(err))
      this.ws.on('message', raw => this.onMessage(JSON.parse(String(raw))))
    })
  }

  async initialize(clientInfo = { name: 'codex-discord-bridge', version: '0' }): Promise<void> {
    await this.request('initialize', { clientInfo })
    this.notify('initialized', {})
  }

  request<T = any>(method: string, params: any): Promise<T> {
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.send({ id, method, params })
    })
  }

  notify(method: string, params: any): void { this.send({ method, params }) }
  onNotification(fn: (method: string, params: any) => void): void { this.notifyHandlers.push(fn) }
  onServerRequest(fn: ServerRequestHandler): void { this.serverRequestHandler = fn }
  close(): void { try { this.ws?.close() } catch {} }

  private send(o: unknown): void { this.ws?.send(JSON.stringify(o)) }

  private onMessage(msg: any): void {
    // response to our request
    if (msg.id != null && (msg.result !== undefined || msg.error !== undefined) && !msg.method) {
      const p = this.pending.get(msg.id)
      if (p) { this.pending.delete(msg.id); msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result) }
      return
    }
    // server→client request (has id AND method)
    if (msg.id != null && msg.method) {
      const handler = this.serverRequestHandler
      Promise.resolve(handler ? handler(msg.method, msg.params) : Promise.reject(new Error('no handler')))
        .then(result => this.send({ id: msg.id, result }))
        .catch(err => this.send({ id: msg.id, error: { code: -32000, message: String(err) } }))
      return
    }
    // notification
    if (msg.method) for (const fn of this.notifyHandlers) fn(msg.method, msg.params)
  }
}
```

- [ ] **Step 4: Run test to verify it passes** — `npx tsx --test test/appserver-client.test.ts` → PASS (3 tests). `npm run typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/appserver-client.ts test/appserver-client.test.ts
git commit -m "feat(appserver): ws JSON-RPC client with server-request routing"
```

---

## Task 4: app-server manager (spawn + supervise)

**Files:**
- Create: `src/appserver-manager.ts`

**Interfaces:**
- Consumes: `AppServerClient` (Task 3), `node:child_process`, `node:net`.
- Produces:
  - `type AppServerManagerOptions = { codexBin: string; host?: string; port?: number; token?: string; env?: Record<string,string>; log?: (line: string) => void }`
  - `class AppServerManager { constructor(opts: AppServerManagerOptions); start(): Promise<void>; client(): AppServerClient; remoteUrl(): string; stop(): void }`
  - `start()` picks a free port when `port` is `0` (via `node:net` `server.listen(0)` then close), spawns `codex app-server --listen ws://host:port`, polls `http://host:port/readyz` until 200 (≤10 s), then connects+initializes one shared `AppServerClient`. Restarts the child on unexpected exit (backoff 1 s) and reconnects the client.

- [ ] **Step 1: Implement** — `src/appserver-manager.ts`

```ts
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { AppServerClient } from './appserver-client.js'

export type AppServerManagerOptions = {
  codexBin: string
  host?: string
  port?: number
  token?: string
  env?: Record<string, string>
  log?: (line: string) => void
}

async function freePort(host: string): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const srv = createServer()
    srv.on('error', reject)
    srv.listen(0, host, () => {
      const port = (srv.address() as any).port as number
      srv.close(() => resolve(port))
    })
  })
}

async function waitReady(url: string, ms = 10000): Promise<void> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch {}
    await new Promise(r => setTimeout(r, 200))
  }
  throw new Error(`app-server not ready at ${url}`)
}

export class AppServerManager {
  private child?: ChildProcess
  private sharedClient?: AppServerClient
  private host: string
  private port = 0
  private stopped = false

  constructor(private opts: AppServerManagerOptions) { this.host = opts.host ?? '127.0.0.1' }

  async start(): Promise<void> {
    this.port = this.opts.port && this.opts.port > 0 ? this.opts.port : await freePort(this.host)
    await this.spawnChild()
    await waitReady(`http://${this.host}:${this.port}/readyz`)
    this.sharedClient = new AppServerClient(this.remoteUrl(), { token: this.opts.token })
    await this.sharedClient.connect()
    await this.sharedClient.initialize()
  }

  private async spawnChild(): Promise<void> {
    const args = ['app-server', '--listen', `ws://${this.host}:${this.port}`]
    this.child = spawn(this.opts.codexBin, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: this.opts.env ? { ...process.env, ...this.opts.env } : process.env,
    })
    this.child.stderr?.setEncoding('utf8')
    this.child.stderr?.on('data', d => this.opts.log?.(`[app-server] ${String(d).trimEnd()}`))
    this.child.on('exit', code => {
      if (this.stopped) return
      this.opts.log?.(`[app-server] exited ${code}; restarting`)
      setTimeout(() => { void this.restart() }, 1000)
    })
  }

  private async restart(): Promise<void> {
    if (this.stopped) return
    await this.spawnChild()
    await waitReady(`http://${this.host}:${this.port}/readyz`)
    this.sharedClient = new AppServerClient(this.remoteUrl(), { token: this.opts.token })
    await this.sharedClient.connect()
    await this.sharedClient.initialize()
  }

  client(): AppServerClient {
    if (!this.sharedClient) throw new Error('AppServerManager not started')
    return this.sharedClient
  }
  remoteUrl(): string { return `ws://${this.host}:${this.port}` }
  stop(): void { this.stopped = true; try { this.sharedClient?.close() } catch {}; try { this.child?.kill('SIGTERM') } catch {} }
}
```

- [ ] **Step 2: Typecheck** — `npm run typecheck` → clean. (Live behaviour is covered by the E2E verification in Task 7; no unit test — spawning real codex belongs in the gated E2E.)

- [ ] **Step 3: Commit**

```bash
git add src/appserver-manager.ts
git commit -m "feat(appserver): spawn + supervise codex app-server, shared client"
```

---

## Task 5: Drop-in runner `runCodexViaAppServer`

**Files:**
- Create: `src/appserver-runner.ts`
- Test: `test/appserver-runner.test.ts`

**Interfaces:**
- Consumes: `AppServerManager` (Task 4), `translateNotification`/`agentTextOf` (Task 2), `CodexRunOptions`/`CodexRunResult`/`CodexRunInterruptedError` (from `codex-runner.ts`).
- Produces:
  - `function makeAppServerRunner(manager: { client(): AppServerClient }): (opts: CodexRunOptions) => Promise<CodexRunResult>`
  - The returned function has the SAME shape as `runCodex`. Behaviour:
    1. If `opts.codexThreadId` is falsy → `thread/start { cwd, approvalPolicy: opts sandbox mapping, sandbox }` to get `threadId`, then `thread/inject_items { threadId, items: [{ type: 'text', text: '(session initialized by codex-discord bridge)' }] }` to flush rollout.
    2. Subscribe to notifications; for each, `translateNotification` → for every exec event: push to `events`, `await onEvent(ev)`, capture `codexThreadId` from `thread.started`, set `finalText` from `agentTextOf`.
    3. `turn/start { threadId, input: [{ type: 'text', text: opts.prompt }] }`; resolve when a `turn/completed` notification for this run arrives.
    4. On `opts.signal` abort → `turn/interrupt { threadId }` and reject with `CodexRunInterruptedError`.

- [ ] **Step 1: Write the failing test** — `test/appserver-runner.test.ts` (uses a fake client that scripts notifications)

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeAppServerRunner } from '../src/appserver-runner.js'

function fakeClient() {
  const notifyHandlers: Array<(m: string, p: any) => void> = []
  const calls: any[] = []
  return {
    calls,
    emit: (m: string, p: any) => notifyHandlers.forEach(fn => fn(m, p)),
    client() {
      return {
        onNotification: (fn: any) => notifyHandlers.push(fn),
        onServerRequest: () => {},
        notify: () => {},
        async request(method: string, params: any) {
          calls.push({ method, params })
          if (method === 'thread/start') return { thread: { id: 'NEWTHREAD' } }
          return {}
        },
      }
    },
  }
}

test('new session: start → inject flush → turn/start, emits translated events, returns finalText', async () => {
  const fake = fakeClient()
  const run = makeAppServerRunner(fake as any)
  const events: any[] = []
  const p = run({ cwd: '/tmp', prompt: 'hi', sandbox: 'workspace-write', onEvent: e => { events.push(e) } } as any)
  await new Promise(r => setTimeout(r, 20))
  // engine streams a turn then completes
  fake.emit('thread/started', { thread: { id: 'NEWTHREAD' } })
  fake.emit('item/completed', { item: { type: 'agentMessage', text: 'hello back' } })
  fake.emit('turn/completed', {})
  const res = await p
  assert.equal(res.codexThreadId, 'NEWTHREAD')
  assert.equal(res.finalText, 'hello back')
  const methods = fake.calls.map(c => c.method)
  assert.deepEqual(methods, ['thread/start', 'thread/inject_items', 'turn/start'])
  assert.ok(events.some(e => e.type === 'item.completed' && e.item.type === 'agent_message'))
})

test('resume existing thread skips start/inject', async () => {
  const fake = fakeClient()
  const run = makeAppServerRunner(fake as any)
  const p = run({ cwd: '/tmp', prompt: 'again', codexThreadId: 'OLD', onEvent: () => {} } as any)
  await new Promise(r => setTimeout(r, 20))
  fake.emit('turn/completed', {})
  await p
  assert.deepEqual(fake.calls.map(c => c.method), ['turn/start'])
})
```

- [ ] **Step 2: Run test to verify it fails** — `npx tsx --test test/appserver-runner.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement** — `src/appserver-runner.ts`

```ts
import type { CodexRunOptions, CodexRunResult } from './codex-runner.js'
import { CodexRunInterruptedError } from './codex-runner.js'
import type { AppServerClient } from './appserver-client.js'
import { translateNotification, agentTextOf } from './appserver-protocol.js'

const PRIMING_TEXT = '(session initialized by codex-discord bridge)'

export function makeAppServerRunner(manager: { client(): AppServerClient }): (opts: CodexRunOptions) => Promise<CodexRunResult> {
  return function runCodexViaAppServer(opts: CodexRunOptions): Promise<CodexRunResult> {
    const client = manager.client()
    return new Promise<CodexRunResult>((resolve, reject) => {
      const events: unknown[] = []
      let codexThreadId = opts.codexThreadId ?? ''
      let finalText = ''
      let settled = false
      let threadId = opts.codexThreadId ?? ''

      const onAbort = () => {
        if (settled) return
        if (threadId) client.notify('turn/interrupt', { threadId })
        settle(() => reject(new CodexRunInterruptedError()))
      }
      function settle(fn: () => void) {
        if (settled) return
        settled = true
        opts.signal?.removeEventListener('abort', onAbort)
        fn()
      }

      client.onNotification((method, params) => {
        for (const ev of translateNotification(method, params)) {
          events.push(ev)
          if (ev.type === 'thread.started' && typeof (ev as any).thread_id === 'string') codexThreadId = (ev as any).thread_id
          const t = agentTextOf(ev)
          if (t) finalText = t
          void Promise.resolve(opts.onEvent?.(ev)).catch(() => {})
        }
        if (method === 'turn/completed') settle(() => resolve({ codexThreadId, finalText, events }))
      })

      if (opts.signal?.aborted) return onAbort()
      opts.signal?.addEventListener('abort', onAbort, { once: true })

      void (async () => {
        try {
          if (!threadId) {
            const started = await client.request<{ thread: { id: string } }>('thread/start', {
              cwd: opts.cwd,
              sandbox: opts.sandbox ?? 'workspace-write',
              approvalPolicy: 'on-request',
            })
            threadId = started.thread.id
            codexThreadId = threadId
            await client.request('thread/inject_items', { threadId, items: [{ type: 'text', text: PRIMING_TEXT }] })
          }
          await client.request('turn/start', { threadId, input: [{ type: 'text', text: opts.prompt }] })
        } catch (err) {
          settle(() => reject(err instanceof Error ? err : new Error(String(err))))
        }
      })()
    })
  }
}
```

> Note: `opts.sandbox` is a string on `CodexRunOptions`? It is not — `CodexRunOptions` has no `sandbox`. Pass sandbox via `opts.codexOptions` is exec-specific. For app-server, read sandbox from a new optional field. **Add `sandbox?: string` to `CodexRunOptions` in `src/codex-runner.ts`** (additive, unused by exec path) so the daemon can thread it through. Update the test's cast accordingly (already casts `as any`).

- [ ] **Step 4: Add `sandbox?: string` to `CodexRunOptions`** in `src/codex-runner.ts` (one line, after `imagePaths?`). Run `npm run typecheck` → clean.

- [ ] **Step 5: Run test to verify it passes** — `npx tsx --test test/appserver-runner.test.ts` → PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/appserver-runner.ts src/codex-runner.ts test/appserver-runner.test.ts
git commit -m "feat(appserver): drop-in runner translating turns to exec-JSON events"
```

---

## Task 6: Wire engine selection + attach command into the daemon

**Files:**
- Modify: `src/start.ts`, `src/start-options.ts`, `src/discord-daemon.ts`

**Interfaces:**
- Consumes: `resolveRuntimeConfig().engine/appServerPort/appServerTokenEnv` (Task 1), `AppServerManager` (Task 4), `makeAppServerRunner` (Task 5).
- Produces: `DiscordDaemonOptions` gains `remoteAttachCommand?: (codexThreadId: string) => string`. When set, the `!codex` landing message and `!attach` output include the ready-to-copy line.

- [ ] **Step 1: Thread the runner + attach command through options.** In `src/start.ts` (and `src/start-options.ts` where `DiscordDaemonOptions` is assembled): when `runtime.engine === 'app-server'`, construct and `await manager.start()`, then pass:
```ts
const token = runtime.appServerTokenEnv ? process.env[runtime.appServerTokenEnv] : undefined
const manager = new AppServerManager({ codexBin: runtime.codexBin, port: runtime.appServerPort, token, log: line => console.error(line) })
await manager.start()
const runCodex = makeAppServerRunner(manager)
const remoteAttachCommand = (id: string) =>
  `codex resume ${id} --remote ${manager.remoteUrl()}` + (runtime.appServerTokenEnv ? ` --remote-auth-token-env ${runtime.appServerTokenEnv}` : '')
```
Pass `runCodex` and `remoteAttachCommand` into `startDiscordDaemon({ ... })`. For `engine === 'exec'`, keep the existing `runCodex` import and leave `remoteAttachCommand` undefined.

- [ ] **Step 2: Add the option field.** In `src/discord-daemon.ts` `DiscordDaemonOptions` add:
```ts
  remoteAttachCommand?: (codexThreadId: string) => string
```

- [ ] **Step 3: Surface the attach line.** In `runCodexForThread` after a successful run (near `src/discord-daemon.ts:1243-1251`, where the binding is saved and completion is posted), when `opts.remoteAttachCommand` is set and this was a NEW session (no prior binding), append to the completion/landing message:
```ts
if (opts.remoteAttachCommand) {
  await sendMessage(discordThreadId,
    `Terminal attach (same live session):\n\`\`\`sh\n${opts.remoteAttachCommand(result.codexThreadId)}\n\`\`\``)
}
```
And in the `!attach` command handler (search `command === '!attach'`, currently builds a `cd … && codex resume` string at `src/discord-daemon.ts:1111`), when `opts.remoteAttachCommand` is set, replace the printed command with `opts.remoteAttachCommand(binding.codexThreadId)`.

- [ ] **Step 4: Typecheck + existing smoke** — `npm run typecheck` → clean. `npm run smoke` → unchanged behaviour (exec path still default). `npx tsx --test test/*.test.ts` → all pass.

- [ ] **Step 5: Commit**

```bash
git add src/start.ts src/start-options.ts src/discord-daemon.ts
git commit -m "feat(appserver): select engine at startup and surface terminal attach command"
```

---

## Task 7: E2E verification + docs + test script

**Files:**
- Modify: `package.json` (add `test` script), `docs/verification.md`
- Create: `scripts/e2e-appserver.mjs` (gated, real codex)

**Interfaces:** none (verification only).

- [ ] **Step 1: Add test script** to `package.json` scripts: `"test": "tsx --test test/*.test.ts"`. Run `npm test` → all unit tests pass.

- [ ] **Step 2: Write the E2E script** — `scripts/e2e-appserver.mjs` (promotes spike5/6): starts an `AppServerManager` via the built `dist/`, runs `makeAppServerRunner` twice (new session, then resume), asserts `finalText` non-empty and `codexThreadId` stable, and asserts the rollout file exists after the first run (so terminal attach would succeed). It prints `E2E OK` on success and exits non-zero on failure.

```js
import { AppServerManager } from '../dist/appserver-manager.js'
import { makeAppServerRunner } from '../dist/appserver-runner.js'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const mgr = new AppServerManager({ codexBin: process.env.CODEX_BIN ?? 'codex', log: l => console.error(l) })
await mgr.start()
const run = makeAppServerRunner(mgr)
const r1 = await run({ cwd: '/tmp', prompt: 'Reply with exactly the word PONG.', sandbox: 'workspace-write', onEvent: () => {} })
if (!r1.codexThreadId || !r1.finalText) { console.error('FAIL run1', r1); process.exit(1) }
const r2 = await run({ cwd: '/tmp', prompt: 'Reply with exactly the word AGAIN.', codexThreadId: r1.codexThreadId, onEvent: () => {} })
if (r2.codexThreadId !== r1.codexThreadId) { console.error('FAIL resume mismatch', r2); process.exit(1) }
console.log(`E2E OK thread=${r1.codexThreadId} first=${JSON.stringify(r1.finalText)} second=${JSON.stringify(r2.finalText)}`)
mgr.stop(); process.exit(0)
```

- [ ] **Step 3: Build + run E2E** — `npm run build` then `node scripts/e2e-appserver.mjs`. Expected: `E2E OK …` and exit 0. (Requires a working `codex` login; this is the gated real-model check.)

- [ ] **Step 4: Document** — add an "app-server engine (form A)" section to `docs/verification.md`: how to set `CODEX_ENGINE=app-server`, the `!codex` → attach flow, the `codex resume <id> --remote <url>` command, and how to run `npm test` + `node scripts/e2e-appserver.mjs`.

- [ ] **Step 5: Commit**

```bash
git add package.json docs/verification.md scripts/e2e-appserver.mjs
git commit -m "test(appserver): unit test script + gated real-model E2E + docs"
```

---

## Self-review notes

- **Spec coverage:** engine behind `CODEX_ENGINE` (T1) ✓; app-server lifecycle (T4) ✓; drop-in runner + event translation (T2,T5) ✓; `!codex` inject-flush + attach command (T5 runner, T6 daemon) ✓; inbound turn/steer — deferred as follow-up (see below); approvals — client server-request routing exists (T3); full Discord-reaction approval UI deferred to a follow-up task; error handling: manager restart (T4), turn interrupt maps to `CodexRunInterruptedError` (T5) ✓; testing (T2,T3,T5 unit; T7 E2E) ✓.
- **Deferred (explicitly out of this plan, documented so nothing is silently dropped):** (a) mid-turn `turn/steer` for messages arriving during an in-flight turn — the current daemon already queues via `!queue`/active-run handling, so app-server mode inherits queueing; live steer is a UX enhancement. (b) Native approval → Discord ✅/❌ reaction UI; the transport (server-request handler) is in place (T3), the reaction surface is a follow-up. Both are listed here so the reviewer knows they are intentional, not forgotten.
- **Type consistency:** runner returns `CodexRunResult { codexThreadId, finalText, events }` everywhere; `AppServerClient` method names match across T3/T4/T5; `translateNotification`/`agentTextOf` names consistent T2↔T5.
