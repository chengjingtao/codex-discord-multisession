import type { CodexRunOptions, CodexRunResult } from './codex-runner.js'
import { CodexRunInterruptedError } from './codex-runner.js'
import type { AppServerClient } from './appserver-client.js'
import { translateNotification, agentTextOf } from './appserver-protocol.js'

const PRIMING_TEXT = '(session initialized by codex-discord bridge)'

/**
 * Build a runner with the SAME signature as `runCodex`, driving turns over one
 * shared app-server client. It translates app-server v2 notifications into the
 * exec-JSON events the daemon already formats, so the daemon stays unchanged.
 *
 * Because the client is shared across all threads, each run filters
 * notifications by its own threadId (every turn/item notification carries one).
 */
export function makeAppServerRunner(manager: { client(): AppServerClient }): (opts: CodexRunOptions) => Promise<CodexRunResult> {
  return function runCodexViaAppServer(opts: CodexRunOptions): Promise<CodexRunResult> {
    const client = manager.client()
    return new Promise<CodexRunResult>((resolve, reject) => {
      const events: unknown[] = []
      let codexThreadId = opts.codexThreadId ?? ''
      let finalText = ''
      let settled = false
      let threadId = opts.codexThreadId ?? ''

      const onNotify = (method: string, params: any): void => {
        if (settled) return
        // Filter to this run's thread once known (shared client streams all threads).
        const evThreadId = params?.threadId
        if (threadId && typeof evThreadId === 'string' && evThreadId !== threadId) return
        for (const ev of translateNotification(method, params)) {
          events.push(ev)
          if (ev.type === 'thread.started' && typeof (ev as any).thread_id === 'string') codexThreadId = (ev as any).thread_id
          const t = agentTextOf(ev)
          if (t) finalText = t
          void Promise.resolve(opts.onEvent?.(ev)).catch(() => {})
        }
        if (method === 'turn/completed') settle(() => resolve({ codexThreadId, finalText, events }))
      }

      const onAbort = (): void => {
        if (settled) return
        if (threadId) client.notify('turn/interrupt', { threadId })
        settle(() => reject(new CodexRunInterruptedError()))
      }

      function settle(fn: () => void): void {
        if (settled) return
        settled = true
        opts.signal?.removeEventListener('abort', onAbort)
        ;(client as any).offNotification?.(onNotify)
        fn()
      }

      client.onNotification(onNotify)

      if (opts.signal?.aborted) return onAbort()
      opts.signal?.addEventListener('abort', onAbort, { once: true })

      void (async () => {
        try {
          if (!threadId) {
            const started = await client.request<{ thread: { id: string } }>('thread/start', {
              cwd: opts.cwd,
              sandbox: opts.sandbox ?? 'workspace-write',
              approvalPolicy: 'on-request',
            })
            threadId = started.thread.id
            codexThreadId = threadId
            // Flush rollout to disk (no model call) so a terminal can `resume`.
            await client.request('thread/inject_items', { threadId, items: [{ type: 'text', text: PRIMING_TEXT }] })
          }
          await client.request('turn/start', { threadId, input: [{ type: 'text', text: opts.prompt }] })
        } catch (err) {
          settle(() => reject(err instanceof Error ? err : new Error(String(err))))
        }
      })()
    })
  }
}
