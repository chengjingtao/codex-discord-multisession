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

test('new session: start -> inject flush -> turn/start, emits translated events, returns finalText', async () => {
  const fake = fakeClient()
  const run = makeAppServerRunner(fake as any)
  const events: any[] = []
  const p = run({ cwd: '/tmp', prompt: 'hi', sandbox: 'workspace-write', onEvent: e => { events.push(e) } } as any)
  await new Promise(r => setTimeout(r, 20))
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
