import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { AppServerClient } from './appserver-client.js'

export type AppServerManagerOptions = {
  codexBin: string
  host?: string
  port?: number
  token?: string
  env?: Record<string, string>
  /**
   * Global `-c key=value` config overrides applied to the app-server process,
   * so they take effect for EVERY thread it hosts — including threads resumed
   * from an on-disk rollout, which do not otherwise re-receive per-thread
   * sandbox/approval settings. Used to make the whole engine YOLO
   * (`sandbox_mode`, `approval_policy`).
   */
  configOverrides?: string[]
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

/**
 * Owns the single long-lived `codex app-server` process for the bridge and one
 * shared JSON-RPC client. Picks a free port when `port` is 0, waits for
 * /readyz, and restarts the child (with reconnect) if it exits unexpectedly.
 */
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
    await this.connectClient()
  }

  private async connectClient(): Promise<void> {
    this.sharedClient = new AppServerClient(this.remoteUrl(), { token: this.opts.token })
    await this.sharedClient.connect()
    await this.sharedClient.initialize()
  }

  private async spawnChild(): Promise<void> {
    // `-c` overrides are global options and must precede the `app-server` subcommand.
    const configFlags = (this.opts.configOverrides ?? []).flatMap(o => ['-c', o])
    const args = [...configFlags, 'app-server', '--listen', `ws://${this.host}:${this.port}`]
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
    try {
      await this.spawnChild()
      await waitReady(`http://${this.host}:${this.port}/readyz`)
      await this.connectClient()
    } catch (err) {
      this.opts.log?.(`[app-server] restart failed: ${String(err)}`)
    }
  }

  client(): AppServerClient {
    if (!this.sharedClient) throw new Error('AppServerManager not started')
    return this.sharedClient
  }

  remoteUrl(): string { return `ws://${this.host}:${this.port}` }

  stop(): void {
    this.stopped = true
    try { this.sharedClient?.close() } catch {}
    try { this.child?.kill('SIGTERM') } catch {}
  }
}
