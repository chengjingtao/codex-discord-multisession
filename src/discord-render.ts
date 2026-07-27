// Pure formatters for readable Discord rendering (hybrid direction C).
// The daemon feeds these translated exec-JSON item data; they return Discord
// message strings. No I/O here so they stay unit-testable.

const CMD_MAX = 200
const FAIL_MAX_LINES = 12
const FAIL_MAX_CHARS = 1200

function collapse(text: string): string {
  return text.replace(/\s*\n+\s*/g, '; ').replace(/\s+/g, ' ').trim()
}

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text
  return `${text.slice(0, Math.max(0, limit - 1))}…`
}

function fenceSafe(text: string): string {
  return text.replace(/```/g, '``​`')
}

// Neutralize backticks so a command is safe inside inline `code`.
function inlineSafe(text: string): string {
  return text.replace(/`/g, 'ˋ')
}

// Strip a `… -lc '<script>'` shell wrapper to show the inner command codex ran.
function unwrapShell(cmd: string): string {
  const m = /-l?c\s+'([\s\S]*)'\s*$/.exec(cmd.trim())
  return m ? m[1] : cmd
}

export type CommandItem = {
  command: string
  exit_code: number | null
  aggregated_output: string
  duration_ms?: number | null
}

// Cap output to the first `maxLines` lines and `maxChars` chars. Returns the
// shown text plus how many whole lines were dropped (for a "+N 行" marker).
function capOutput(output: string, maxLines: number, maxChars: number): { shown: string; moreLines: number } {
  const lines = output.split('\n')
  const kept = lines.slice(0, maxLines)
  let shown = kept.join('\n')
  if (shown.length > maxChars) shown = `${shown.slice(0, Math.max(0, maxChars - 1))}…`
  return { shown, moreLines: Math.max(0, lines.length - kept.length) }
}

/**
 * Render a command execution as a LIGHTWEIGHT line, not a heavy embed, so the
 * visual focus stays on the agent's prose. Successful commands are a single
 * muted subtext line (`-# ✅ …`); failures keep the subtext line and expand
 * the error output (capped) so it's still debuggable.
 */
export function commandLine(item: CommandItem): string {
  const ok = item.exit_code === 0
  const emoji = ok ? '✅' : '❌'
  const cmd = inlineSafe(truncate(collapse(unwrapShell(item.command)) || '(command)', CMD_MAX))
  const durText = typeof item.duration_ms === 'number' ? ` · ${(item.duration_ms / 1000).toFixed(1)}s` : ''
  const head = `-# ${emoji} \`${cmd}\` · exit ${item.exit_code ?? '?'}${durText}`
  if (ok) return head
  const output = item.aggregated_output.trim()
  if (!output) return head
  const { shown, moreLines } = capOutput(output, FAIL_MAX_LINES, FAIL_MAX_CHARS)
  const marker = moreLines > 0 ? `\n… +${moreLines} 行` : ''
  return `${head}\n\`\`\`text\n${fenceSafe(shown)}${marker}\n\`\`\``
}

export function reasoningSpoiler(text: string): string {
  const safe = text.replace(/\|\|/g, '|​|').trim()
  return `🧠 ||${safe}||`
}

export function agentProse(text: string): string {
  return `💬 ${text}`
}

export function runningStatus(elapsedSeconds: number, note?: string): string {
  const mid = note ? ` · ${note}` : ''
  return `⏳ Codex 运行中 (${elapsedSeconds}s)${mid} · \`!stop\` 中断`
}

export function completedStatus(elapsedSeconds: number): string {
  return `✅ 完成 (${elapsedSeconds}s)`
}
