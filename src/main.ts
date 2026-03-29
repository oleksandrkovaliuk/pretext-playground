import { decodeGif, createSequencer, type GifSequencer } from './gif-decoder.ts'
import { initTextFlow, renderFrame, type TextFlowState } from './silhouette-renderer.ts'
import { prepareWithSegments, type PreparedTextWithSegments } from '@chenglou/pretext'
import { BAD_APPLE_TEXT, KAGEROU_TEXT } from './text-content.ts'

const FONT_SIZE = 7
const LINE_HEIGHT = 9
const FONT = `${FONT_SIZE}px Georgia, Palatino, "Times New Roman", serif`

const GRID_CELLS_PER_LINE = 3
const MAX_GRID_CELLS = 500_000

type DemoConfig = {
  id: string
  label: string
  url: string
  speed: number
  text: string
}

const DEMOS: DemoConfig[] = [
  { id: 'bad-apple', label: 'Bad Apple', url: '/assets/bad-apple.gif', speed: 1.5, text: BAD_APPLE_TEXT },
  { id: 'kagerou', label: 'Kagerou Project', url: '/assets/89f5a4e0246d84f57f6d67376dbdec58.gif', speed: 1, text: KAGEROU_TEXT },
]

const artEl = document.getElementById('art')!
const statsEl = document.getElementById('stats')!
const loadingEl = document.getElementById('loading')
const navEl = document.getElementById('demo-nav')!

type CachedDecode = {
  frames: import('./gif-decoder.ts').CompactFrame[]
  delays: number[]
  gifWidth: number
  gifHeight: number
  gridCols: number
  gridRows: number
}

const gifCache = new Map<string, CachedDecode>()

let sequencer: GifSequencer
let flowState: TextFlowState
let startTime = 0
let rafId = 0
let activeDemo = ''
let loadGeneration = 0
let currentSpeed = 1

const fpsTimestamps: number[] = []
let fpsDisplay = 60

function updateFPS(now: number): void {
  fpsTimestamps.push(now)
  while (fpsTimestamps.length > 0 && fpsTimestamps[0]! < now - 1000) {
    fpsTimestamps.shift()
  }
  fpsDisplay = fpsTimestamps.length
}

let lastStatsUpdate = 0
let lastRenderMs = 0

function render(now: number): void {
  rafId = requestAnimationFrame(render)

  if (!startTime) startTime = now
  const elapsed = (now - startTime) * currentSpeed

  const t0 = performance.now()
  const frameIndex = sequencer.getFrameIndexAt(elapsed)
  renderFrame(flowState, frameIndex)
  lastRenderMs = performance.now() - t0

  updateFPS(now)

  if (now - lastStatsUpdate > 400) {
    lastStatsUpdate = now
    statsEl.textContent =
      `${flowState.charCount} chars | ` +
      `${flowState.lineCount} lines | ` +
      `${sequencer.frames.length} frames | ` +
      `${lastRenderMs.toFixed(1)}ms | ` +
      `${fpsDisplay} fps`
  }
}

function buildNav(): void {
  for (const demo of DEMOS) {
    const btn = document.createElement('button')
    btn.className = 'demo-btn'
    btn.textContent = demo.label
    btn.dataset.id = demo.id
    btn.addEventListener('click', () => loadDemo(demo.id))
    navEl.appendChild(btn)
  }
}

function updateNavActive(id: string): void {
  const btns = navEl.querySelectorAll('.demo-btn')
  for (let i = 0; i < btns.length; i++) {
    const btn = btns[i] as HTMLElement
    btn.classList.toggle('active', btn.dataset.id === id)
  }
}

function computeGrid(viewW: number, viewH: number): { gridCols: number; gridRows: number } {
  let gridCols = Math.ceil(viewW * GRID_CELLS_PER_LINE / LINE_HEIGHT)
  let gridRows = Math.ceil(viewH * GRID_CELLS_PER_LINE / LINE_HEIGHT)

  const cells = gridCols * gridRows
  if (cells > MAX_GRID_CELLS) {
    const scale = Math.sqrt(MAX_GRID_CELLS / cells)
    gridCols = Math.round(gridCols * scale)
    gridRows = Math.round(gridRows * scale)
  }

  return { gridCols, gridRows }
}

const preparedCache = new Map<string, PreparedTextWithSegments>()

async function loadDemo(id: string): Promise<void> {
  const demo = DEMOS.find(d => d.id === id)
  if (!demo) return
  if (id === activeDemo) return

  const generation = ++loadGeneration
  activeDemo = id
  currentSpeed = demo.speed
  updateNavActive(id)
  location.hash = id

  if (rafId) {
    cancelAnimationFrame(rafId)
    rafId = 0
  }
  startTime = 0

  let preparedText = preparedCache.get(demo.id)
  if (!preparedText) {
    preparedText = prepareWithSegments(demo.text, FONT)
    preparedCache.set(demo.id, preparedText)
  }

  const viewW = window.innerWidth
  const viewH = window.innerHeight - 36
  const { gridCols, gridRows } = computeGrid(viewW, viewH)

  const cacheKey = `${demo.url}:${gridCols}x${gridRows}`
  let decoded = gifCache.get(cacheKey)

  if (!decoded) {
    const result = await decodeGif(demo.url, gridCols, gridRows)
    if (generation !== loadGeneration) return
    decoded = { ...result, gridCols, gridRows }
    gifCache.set(cacheKey, decoded)
  }

  sequencer = createSequencer(decoded.frames, decoded.delays, decoded.gifWidth, decoded.gifHeight)

  const existingPool = flowState?.pool
  flowState = initTextFlow(
    artEl, preparedText, FONT, LINE_HEIGHT,
    decoded.frames, viewW, viewH, existingPool,
  )
  if (generation !== loadGeneration) return

  rafId = requestAnimationFrame(render)
}

let resizeTimer = 0
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer)
  resizeTimer = window.setTimeout(() => {
    if (!activeDemo) return
    const id = activeDemo
    activeDemo = ''
    startTime = 0
    loadDemo(id)
  }, 300)
})

async function init(): Promise<void> {
  await document.fonts.ready

  buildNav()

  const hashId = location.hash.replace('#', '')
  const startId = DEMOS.find(d => d.id === hashId) ? hashId : DEMOS[0]!.id

  if (loadingEl) loadingEl.textContent = 'Decoding GIF...'
  await loadDemo(startId)
  if (loadingEl) loadingEl.remove()
}

init()
