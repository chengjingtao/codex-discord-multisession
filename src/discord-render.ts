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
const OUTPUT_MAX = 1500

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

export function commandEmbed(item: CommandItem): DiscordEmbed {
  const ok = item.exit_code === 0
  const title = `⚡ ${truncate(collapse(item.command) || '(command)', TITLE_MAX)}`
  const output = item.aggregated_output.trim()
  const description = output
    ? `\`\`\`text\n${fenceSafe(truncate(output, OUTPUT_MAX))}\n\`\`\``
    : '_(no output)_'
  const exitText = `exit ${item.exit_code ?? '?'}`
  const durText = typeof item.duration_ms === 'number' ? ` · ${(item.duration_ms / 1000).toFixed(1)}s` : ''
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
