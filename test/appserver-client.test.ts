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

test('server->client request is answered via onServerRequest', async () => {
  let answer: any
  const srv = await fakeServer((msg, send) => {
    if (msg.method === 'kick') { send({ id: 99, method: 'item/permissions/requestApproval', params: { approvalId: 'a1' } }) }
    if (msg.id === 99 && msg.result) { answer = msg.result }
  })
  const c = new AppServerClient(srv.url)
  await c.connect()
  c.onServerRequest(async (_method, params) => ({ decision: 'approved', for: params.approvalId }))
  c.notify('kick', {})
  await new Promise(r => setTimeout(r, 80))
  assert.deepEqual(answer, { decision: 'approved', for: 'a1' })
  c.close(); srv.close()
})
