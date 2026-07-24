import WebSocket from 'ws'

export type ServerRequestHandler = (method: string, params: any) => Promise<any>

/**
 * Line-delimited JSON-RPC client for `codex app-server`.
 * - `request` correlates responses by numeric id.
 * - server->client requests (they carry both `id` and `method`) are routed to
 *   the registered `onServerRequest` handler; its resolved value is sent back.
 * - fire-and-forget notifications reach `onNotification` handlers.
 */
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
  offNotification(fn: (method: string, params: any) => void): void {
    const i = this.notifyHandlers.indexOf(fn)
    if (i >= 0) this.notifyHandlers.splice(i, 1)
  }
  onServerRequest(fn: ServerRequestHandler): void { this.serverRequestHandler = fn }
  close(): void { try { this.ws?.close() } catch {} }

  private send(o: unknown): void { this.ws?.send(JSON.stringify(o)) }

  private onMessage(msg: any): void {
    // response to one of our requests
    if (msg.id != null && !msg.method && (msg.result !== undefined || msg.error !== undefined)) {
      const p = this.pending.get(msg.id)
      if (p) {
        this.pending.delete(msg.id)
        if (msg.error) p.reject(new Error(JSON.stringify(msg.error)))
        else p.resolve(msg.result)
      }
      return
    }
    // server->client request (has both id and method)
    if (msg.id != null && msg.method) {
      const handler = this.serverRequestHandler
      Promise.resolve(handler ? handler(msg.method, msg.params) : Promise.reject(new Error('no server-request handler')))
        .then(result => this.send({ id: msg.id, result }))
        .catch(err => this.send({ id: msg.id, error: { code: -32000, message: String(err) } }))
      return
    }
    // plain notification
    if (msg.method) for (const fn of this.notifyHandlers) fn(msg.method, msg.params)
  }
}
