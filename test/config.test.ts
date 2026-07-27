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
