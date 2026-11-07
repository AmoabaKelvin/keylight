// Browser development only: the endpoints the Tauri backend provides, so `pnpm dev` in a browser
// talks to the same daemon and Karabiner file as the app does.
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { createConnection } from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Plugin } from 'vite'

const SOCK = join(homedir(), 'Library/Application Support/Keylight/keylight.sock')
const KARABINER = join(homedir(), '.config/karabiner/karabiner.json')

function daemon(msg: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = createConnection(SOCK)
    let out = ''
    sock.on('connect', () => sock.write(msg))
    sock.on('data', (d) => (out += d))
    sock.on('end', () => resolve(out.trim()))
    sock.on('error', reject)
  })
}

function profile(config: any) {
  return config.profiles.find((p: any) => p.selected) ?? config.profiles[0]
}

export function devApi(): Plugin {
  return {
    name: 'keylight-dev-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next()
        let body = ''
        for await (const chunk of req) body += chunk
        try {
          if (req.url === '/api/daemon') {
            const reply = await daemon(body)
            if (reply !== 'ok' && !reply.startsWith('{')) throw new Error(reply)
            return res.end(reply === 'ok' ? '' : reply)
          }
          if (req.url === '/api/karabiner') {
            const config = JSON.parse(readFileSync(KARABINER, 'utf8'))
            const p = profile(config)
            const msg = JSON.parse(body || '{}')
            if (msg.description) {
              const rule = p.complex_modifications.rules.find((r: any) => r.description === msg.description)
              if (msg.enabled) delete rule.enabled
              else rule.enabled = false
              writeFileSync(KARABINER + '.keylight', JSON.stringify(config, null, 2) + '\n')
              renameSync(KARABINER + '.keylight', KARABINER)
              return res.end('')
            }
            const rules = p.complex_modifications.rules.map((r: any) => ({ description: r.description, enabled: r.enabled !== false }))
            return res.end(JSON.stringify({ profile: p.name, rules }))
          }
          next()
        } catch (e) {
          res.statusCode = 500
          res.end(String((e as Error).message ?? e).includes('ENOENT') ? 'daemon-offline' : String((e as Error).message ?? e))
        }
      })
    },
  }
}
