// Pure formatters for readable Discord rendering (hybrid direction C).
// The daemon feeds these translated exec-JSON item data; they return Discord
// message strings / embed objects. No I/O here so they stay unit-testable.

export type DiscordEmbed = {
  title?: string
  description?: string
  color?: number
  footer?: { text: string }
}

export const COLOR = {
  ok: 0x2ecc71, // green — exit 0
  err: 0xe74c3c, // red — nonzero / unknown exit
} as const

const TITLE_MAX = 240
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

export function commandEmbed(item: CommandItem): DiscordEmbed {
  const ok = item.exit_code === 0
  const title = `⚡ ${truncate(collapse(item.command) || '(command)', TITLE_MAX)}`
  const exitText = `exit ${item.exit_code ?? '?'}`
  const durText = typeof item.duration_ms === 'number' ? ` · ${(item.duration_ms / 1000).toFixed(1)}s` : ''

  // A+B: successful commands show no output (just command + exit); failures
  // expand the output, capped to a few lines with a "+N 行" marker.
  let description: string | undefined
  if (!ok) {
    const output = item.aggregated_output.trim()
    if (output) {
      const { shown, moreLines } = capOutput(output, FAIL_MAX_LINES, FAIL_MAX_CHARS)
      const marker = moreLines > 0 ? `\n… +${moreLines} 行` : ''
      description = `\`\`\`text\n${fenceSafe(shown)}${marker}\n\`\`\``
    }
  }

  return {
    title,
    description,
    color: ok ? COLOR.ok : COLOR.err,
    footer: { text: `${exitText}${durText}` },
  }
}

export function reasoningSpoiler(text: string): string {
  // Neutralize internal spoiler bars so they don't break the wrapper.
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
