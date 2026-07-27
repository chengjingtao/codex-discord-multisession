// Gated real-model E2E for the app-server engine. Requires a working `codex`
// login. Starts an app-server, drives a new session then resumes it, and
// asserts the rollout persisted (so a terminal `codex resume --remote` would
// attach to the same live thread). Run via: npm run e2e:appserver
import { AppServerManager } from '../dist/appserver-manager.js'
import { makeAppServerRunner } from '../dist/appserver-runner.js'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

function rolloutExistsFor(threadId) {
  const root = join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'sessions')
  const stack = [root]
  while (stack.length) {
    const dir = stack.pop()
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { continue }
    for (const e of entries) {
      const p = join(dir, e.name)
      if (e.isDirectory()) stack.push(p)
      else if (e.isFile() && e.name.includes(threadId)) return true
    }
  }
  return false
}

const mgr = new AppServerManager({ codexBin: process.env.CODEX_BIN ?? 'codex', log: l => console.error(l) })
await mgr.start()
console.error(`app-server ready on ${mgr.remoteUrl()}`)
const run = makeAppServerRunner(mgr)

const r1 = await run({ cwd: '/tmp', prompt: 'Reply with exactly the word PONG.', sandbox: 'workspace-write', onEvent: () => {} })
if (!r1.codexThreadId || !r1.finalText) { console.error('FAIL run1', r1); mgr.stop(); process.exit(1) }
if (!rolloutExistsFor(r1.codexThreadId)) { console.error('FAIL rollout not persisted for', r1.codexThreadId); mgr.stop(); process.exit(1) }

const r2 = await run({ cwd: '/tmp', prompt: 'Reply with exactly the word AGAIN.', codexThreadId: r1.codexThreadId, onEvent: () => {} })
if (r2.codexThreadId !== r1.codexThreadId) { console.error('FAIL resume mismatch', r2); mgr.stop(); process.exit(1) }

console.log(`E2E OK thread=${r1.codexThreadId} first=${JSON.stringify(r1.finalText)} second=${JSON.stringify(r2.finalText)} rollout=persisted`)
mgr.stop()
process.exit(0)
