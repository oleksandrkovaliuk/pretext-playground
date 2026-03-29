import { existsSync, readFileSync, statSync, readdirSync } from 'fs'
import { join, extname } from 'path'

const isProduction = process.argv.includes('--production')
const ROOT = isProduction ? 'dist' : '.'
const PORT = 3000

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.ts': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
}

async function handleDevRequest(req: Request): Promise<Response> {
  const url = new URL(req.url)
  let pathname = url.pathname

  if (pathname === '/') pathname = '/index.html'

  if (pathname === '/index.html') {
    const html = readFileSync(join('public', 'index.html'), 'utf-8')
    const injected = html.replace(
      '</body>',
      `<script type="module" src="/src/main.ts"></script>\n</body>`,
    )
    return new Response(injected, {
      headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' },
    })
  }

  const candidates = [
    join(ROOT, pathname),
    join('public', pathname),
  ]

  for (const filePath of candidates) {
    if (existsSync(filePath) && statSync(filePath).isFile()) {
      const ext = extname(filePath)
      const mime = MIME[ext] ?? 'application/octet-stream'

      if (ext === '.ts') {
        const result = await Bun.build({
          entrypoints: [filePath],
          target: 'browser',
          sourcemap: 'inline',
        })
        if (result.success && result.outputs[0]) {
          const code = await result.outputs[0].text()
          return new Response(code, {
            headers: { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-cache' },
          })
        }
      }

      return new Response(Bun.file(filePath), {
        headers: { 'Content-Type': mime, 'Cache-Control': 'no-cache' },
      })
    }
  }

  return new Response('Not found', { status: 404 })
}

function handleProductionRequest(req: Request): Response {
  const url = new URL(req.url)
  let pathname = url.pathname
  if (pathname === '/') pathname = '/index.html'

  const filePath = join(ROOT, pathname)
  if (existsSync(filePath) && statSync(filePath).isFile()) {
    const ext = extname(filePath)
    const mime = MIME[ext] ?? 'application/octet-stream'
    return new Response(Bun.file(filePath), {
      headers: { 'Content-Type': mime },
    })
  }

  return new Response('Not found', { status: 404 })
}

Bun.serve({
  port: PORT,
  fetch: isProduction ? handleProductionRequest : handleDevRequest,
})

console.log(`${isProduction ? 'Production' : 'Dev'} server → http://localhost:${PORT}`)
