import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync } from 'fs'
import { join } from 'path'

const DIST = 'dist'

if (existsSync(DIST)) {
  const { rmSync } = await import('fs')
  rmSync(DIST, { recursive: true })
}
mkdirSync(DIST, { recursive: true })

const result = await Bun.build({
  entrypoints: ['src/main.ts'],
  outdir: DIST,
  minify: true,
  sourcemap: 'external',
  target: 'browser',
})

if (!result.success) {
  console.error('Build failed:')
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

const html = Bun.file('public/index.html')
const htmlText = await html.text()
const injectedHtml = htmlText.replace(
  '</body>',
  `<script type="module" src="/main.js"></script>\n</body>`,
)
await Bun.write(join(DIST, 'index.html'), injectedHtml)

if (existsSync('assets')) {
  cpSync('assets', join(DIST, 'assets'), { recursive: true })
}

const publicDir = 'public'
for (const entry of readdirSync(publicDir)) {
  if (entry === 'index.html') continue
  const src = join(publicDir, entry)
  const dest = join(DIST, entry)
  cpSync(src, dest, { recursive: true })
}

console.log(`Build complete → ${DIST}/`)
for (const output of result.outputs) {
  console.log(`  ${output.path} (${(output.size / 1024).toFixed(1)} KB)`)
}
