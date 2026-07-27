import { test } from 'node:test'
import assert from 'node:assert/strict'
import { commandEmbed, reasoningSpoiler, agentProse, runningStatus, completedStatus, COLOR } from '../src/discord-render.js'

test('commandEmbed: success hides output (A) — green, footer, NO description', () => {
  const e = commandEmbed({ command: 'pwd', exit_code: 0, aggregated_output: '/home/x\nlots\nof\noutput\n', duration_ms: 1200 })
  assert.equal(e.color, COLOR.ok)
  assert.equal(e.footer?.text, 'exit 0 · 1.2s')
  assert.match(e.title ?? '', /^⚡ pwd$/)
  assert.equal(e.description, undefined) // output hidden on success
})

test('commandEmbed: failure shows output (B), no duration → footer without dot', () => {
  const e = commandEmbed({ command: 'false', exit_code: 1, aggregated_output: 'boom\n' })
  assert.equal(e.color, COLOR.err)
  assert.equal(e.footer?.text, 'exit 1')
  assert.match(e.description ?? '', /boom/)
})

test('commandEmbed: failure output capped to 12 lines with +N marker', () => {
  const out = Array.from({ length: 20 }, (_, i) => `line${i + 1}`).join('\n')
  const e = commandEmbed({ command: 'x', exit_code: 1, aggregated_output: out })
  assert.match(e.description ?? '', /line1\b/)
  assert.match(e.description ?? '', /line12\b/)
  assert.doesNotMatch(e.description ?? '', /line13\b/)
  assert.match(e.description ?? '', /…\s*\+8\s*行/)
})

test('commandEmbed: null exit treated as failure → red, shows output', () => {
  const e = commandEmbed({ command: 'x', exit_code: null, aggregated_output: 'partial' })
  assert.equal(e.color, COLOR.err)
  assert.equal(e.footer?.text, 'exit ?')
  assert.match(e.description ?? '', /partial/)
})

test('commandEmbed: failure with empty output → no description', () => {
  const e = commandEmbed({ command: 'x', exit_code: 1, aggregated_output: '   ' })
  assert.equal(e.description, undefined)
})

test('commandEmbed: multiline command collapses in title', () => {
  const e = commandEmbed({ command: 'pwd\ncodex --version', exit_code: 0, aggregated_output: 'v' })
  assert.equal(e.title, '⚡ pwd; codex --version')
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
