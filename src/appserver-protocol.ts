export type ExecEvent = Record<string, unknown>

/**
 * Translate ONE codex app-server v2 notification into zero-or-more exec-JSON
 * events — the event shapes `discord-daemon.ts` already knows how to format
 * (see summarizeCodexEvent). This keeps the daemon engine-agnostic.
 */
export function translateNotification(method: string, params: any): ExecEvent[] {
  switch (method) {
    case 'thread/started': {
      const id = params?.thread?.id
      return typeof id === 'string' ? [{ type: 'thread.started', thread_id: id }] : []
    }
    case 'turn/started':
      return [{ type: 'turn.started' }]
    case 'turn/completed':
      return [{ type: 'turn.completed' }]
    case 'item/started': {
      const item = params?.item
      if (item?.type === 'commandExecution') {
        return [{ type: 'item.started', item: { type: 'command_execution', command: String(item.command ?? '') } }]
      }
      return []
    }
    case 'item/completed': {
      const item = params?.item
      if (item?.type === 'commandExecution') {
        return [{ type: 'item.completed', item: {
          type: 'command_execution',
          command: String(item.command ?? ''),
          exit_code: item.exitCode ?? null,
          aggregated_output: typeof item.aggregatedOutput === 'string' ? item.aggregatedOutput : '',
        } }]
      }
      if (item?.type === 'agentMessage') {
        return [{ type: 'item.completed', item: { type: 'agent_message', text: String(item.text ?? '') } }]
      }
      return []
    }
    default:
      return []
  }
}

/** Return the agent text when `ev` is a completed agent_message (for finalText accumulation). */
export function agentTextOf(ev: ExecEvent): string | undefined {
  const item = (ev as any).item
  if (ev.type === 'item.completed' && item?.type === 'agent_message' && typeof item.text === 'string') return item.text
  return undefined
}
