import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

export type BridgeConfig = {
  parentChannelId?: string
  workdir?: string
  proxy?: string
  codexBin?: string
  sandbox?: string
  model?: string
  stateDir?: string
  tokenSource?: 'env'
  engine?: 'exec' | 'app-server'
  appServerPort?: number
  appServerTokenEnv?: string
  /**
   * Discord user IDs of bot accounts permitted to trigger bridge commands.
   * Bot messages are ignored by default; IDs listed here are exempt so a
   * trusted external bot can drive the bridge. Overridable at runtime with
   * CODEX_DISCORD_ALLOW_BOT_IDS (comma-separated).
   */
  allowBotAuthorIds?: string[]
}

function parseBotIds(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined
  return raw.split(',').map(s => s.trim()).filter(Boolean)
}

export function defaultStateDir(): string {
  return join(homedir(), '.codex', 'channels', 'discord')
}

export function defaultConfigFile(): string {
  return join(defaultStateDir(), 'config.json')
}

export function defaultCodexBin(): string {
  return 'codex'
}

export function defaultCodexSandbox(): string {
  return 'workspace-write'
}

export async function loadConfig(file = process.env.CODEX_DISCORD_CONFIG ?? defaultConfigFile()): Promise<BridgeConfig> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as BridgeConfig
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw err
  }
}

export async function saveConfig(config: BridgeConfig, file = process.env.CODEX_DISCORD_CONFIG ?? defaultConfigFile()): Promise<void> {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 })
  const tmp = `${file}.tmp`
  await writeFile(tmp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
  await rename(tmp, file)
}

export function resolveRuntimeConfig(config: BridgeConfig): Required<Pick<BridgeConfig, 'parentChannelId' | 'workdir' | 'codexBin' | 'sandbox' | 'stateDir' | 'engine' | 'appServerPort'>> & BridgeConfig {
  const stateDir = process.env.CODEX_DISCORD_STATE_DIR ?? config.stateDir ?? defaultStateDir()
  return {
    ...config,
    parentChannelId: process.env.CODEX_DISCORD_PARENT_CHANNEL_ID ?? config.parentChannelId ?? '',
    workdir: process.env.CODEX_DISCORD_WORKDIR ?? config.workdir ?? process.cwd(),
    proxy: process.env.CODEX_DISCORD_PROXY ?? config.proxy,
    codexBin: process.env.CODEX_BIN ?? config.codexBin ?? defaultCodexBin(),
    sandbox: process.env.CODEX_SANDBOX ?? process.env.CODEX_DISCORD_SANDBOX ?? config.sandbox ?? defaultCodexSandbox(),
    model: process.env.CODEX_MODEL ?? config.model,
    allowBotAuthorIds: parseBotIds(process.env.CODEX_DISCORD_ALLOW_BOT_IDS) ?? config.allowBotAuthorIds,
    stateDir,
    engine: (process.env.CODEX_ENGINE as 'exec' | 'app-server' | undefined) ?? config.engine ?? 'app-server',
    appServerPort: Number(process.env.CODEX_DISCORD_APP_SERVER_PORT ?? config.appServerPort ?? 0) || 0,
    appServerTokenEnv: process.env.CODEX_DISCORD_APP_SERVER_TOKEN_ENV ?? config.appServerTokenEnv,
  }
}
