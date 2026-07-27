import { test } from 'node:test'
import assert from 'node:assert/strict'
import { commandEmbed, reasoningSpoiler, agentProse, runningStatus, completedStatus, COLOR } from '../src/discord-render.js'

test('commandEmbed: exit 0 → green, footer with duration', () => {
  const e = commandEmbed({ command: 'pwd', exit_code: 0, aggregated_output: '/home/x\n', duration_ms: 1200 })
  assert.equal(e.color, COLOR.ok)
  assert.equal(e.footer?.text, 'exit 0 · 1.2s')
  assert.match(e.title ?? '', /^⚡ pwd$/)
  assert.match(e.description ?? '', /\/home\/x/)
})

test('commandEmbed: nonzero exit → red, no duration → footer without dot', () => {
  const e = commandEmbed({ command: 'false', exit_code: 1, aggregated_output: '' })
  assert.equal(e.color, COLOR.err)
  assert.equal(e.footer?.text, 'exit 1')
})

test('commandEmbed: null exit → red, footer exit ?', () => {
  const e = commandEmbed({ command: 'x', exit_code: null, aggregated_output: '' })
  assert.equal(e.color, COLOR.err)
  assert.equal(e.footer?.text, 'exit ?')
})

test('commandEmbed: multiline command collapses in title', () => {
  const e = commandEmbed({ command: 'pwd\ncodex --version', exit_code: 0, aggregated_output: 'v' })
  assert.equal(e.title, '⚡ pwd; codex --version')
})

test('commandEmbed: empty output → placeholder description', () => {
  const e = commandEmbed({ command: 'x', exit_code: 0, aggregated_output: '   ' })
  assert.match(e.description ?? '', /no output/i)
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
