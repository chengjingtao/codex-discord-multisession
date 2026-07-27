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
