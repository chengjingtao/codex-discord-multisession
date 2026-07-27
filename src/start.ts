import { runCodex } from './codex-runner.js'
import { startDiscordDaemon } from './discord-daemon.js'
import { resolveStartOptions } from './start-options.js'
import { AppServerManager } from './appserver-manager.js'
import { makeAppServerRunner } from './appserver-runner.js'

const config = await resolveStartOptions({ includeHttpProxyFallback: true })

let runner: typeof runCodex = runCodex
let remoteAttachCommand: ((codexThreadId: string) => string) | undefined

if (config.engine === 'app-server') {
  const token = config.appServerTokenEnv ? process.env[config.appServerTokenEnv] : undefined
  const manager = new AppServerManager({
    codexBin: config.codexBin,
    port: config.appServerPort,
    token,
    log: line => console.error(line),
  })
  await manager.start()
  runner = makeAppServerRunner(manager)
  remoteAttachCommand = (codexThreadId: string) =>
    `codex resume ${codexThreadId} --remote ${manager.remoteUrl()}` +
    (config.appServerTokenEnv ? ` --remote-auth-token-env ${config.appServerTokenEnv}` : '')
  console.error(`[engine] app-server live on ${manager.remoteUrl()}`)
}

await startDiscordDaemon({ ...config, runCodex: runner, remoteAttachCommand })
