import { test } from 'node:test'
import assert from 'node:assert/strict'
import { commandLine, reasoningSpoiler, agentProse, runningStatus, completedStatus } from '../src/discord-render.js'

test('commandLine: success → single muted subtext line, no output (A), unwrapped', () => {
  const s = commandLine({ command: "/bin/bash -lc 'echo hello'", exit_code: 0, aggregated_output: 'lots\nof\noutput\n', duration_ms: 1200 })
  assert.equal(s, '-# ✅ `echo hello` · exit 0 · 1.2s')
})

test('commandLine: failure keeps subtext line + expands output (B)', () => {
  const s = commandLine({ command: 'false', exit_code: 1, aggregated_output: 'boom\n' })
  assert.match(s, /^-# ❌ `false` · exit 1/)
  assert.match(s, /```text\nboom\n```/)
})

test('commandLine: failure output capped to 12 lines with +N marker', () => {
  const out = Array.from({ length: 20 }, (_, i) => `line${i + 1}`).join('\n')
  const s = commandLine({ command: 'x', exit_code: 1, aggregated_output: out })
  assert.match(s, /line12\b/)
  assert.doesNotMatch(s, /line13\b/)
  assert.match(s, /…\s*\+8\s*行/)
})

test('commandLine: null exit → failure marker, exit ?', () => {
  const s = commandLine({ command: 'x', exit_code: null, aggregated_output: 'partial' })
  assert.match(s, /^-# ❌ `x` · exit \?/)
  assert.match(s, /partial/)
})

test('commandLine: failure with empty output → just the subtext line', () => {
  const s = commandLine({ command: 'x', exit_code: 1, aggregated_output: '   ' })
  assert.equal(s, '-# ❌ `x` · exit 1')
})

test('commandLine: multiline command collapses', () => {
  const s = commandLine({ command: 'pwd\ncodex --version', exit_code: 0, aggregated_output: 'v' })
  assert.equal(s, '-# ✅ `pwd; codex --version` · exit 0')
})

test('commandLine: backticks in command are neutralized', () => {
  const s = commandLine({ command: 'echo `date`', exit_code: 0, aggregated_output: '' })
  assert.ok(!s.includes('`date`'))
})

test('reasoningSpoiler wraps in spoiler + icon, escapes bars', () => {
  assert.equal(reasoningSpoiler('thinking'), '🧠 ||thinking||')
  assert.ok(!reasoningSpoiler('a||b').includes('a||b')) // internal || neutralized
})

test('agentProse prefixes with speech icon', () => {
  assert.equal(agentProse('hello'), '💬 hello')
})

test('runningStatus + completedStatus', () => {
  assert.equal(runningStatus(5), '⏳ Codex 运行中 (5s) · `!stop` 中断')
  assert.equal(runningStatus(5, 'running command'), '⏳ Codex 运行中 (5s) · running command · `!stop` 中断')
  assert.equal(completedStatus(12), '✅ 完成 (12s)')
})
