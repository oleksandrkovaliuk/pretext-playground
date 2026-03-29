import {
  layoutNextLine,
  type PreparedTextWithSegments,
  type LayoutCursor,
} from '@chenglou/pretext'
import type { CompactFrame } from './gif-decoder.ts'

type PositionedLine = {
  x: number
  y: number
  text: string
  width: number
}

type Slot = {
  left: number
  right: number
}

type ComputedFrame = {
  lines: PositionedLine[]
}

export type TextFlowState = {
  container: HTMLElement
  font: string
  lineHeight: number
  prepared: PreparedTextWithSegments
  frames: CompactFrame[]
  viewWidth: number
  viewHeight: number
  cache: (ComputedFrame | undefined)[]
  pool: HTMLDivElement[]
  prevText: string[]
  prevX: number[]
  prevY: number[]
  prevW: number[]
  activeCount: number
  lastRenderedIndex: number
  lineCount: number
  charCount: number
}

const BRIGHTNESS_THRESHOLD = 128
const SLOT_PADDING_X = 4
const MIN_SLOT_PX = 8

const BG_COLOR = 'rgb(0,0,0)'
const FG_COLOR = 'rgb(0,0,0)'
const LINE_BG_COLOR = 'rgb(255,255,255)'

let _avgBuf: Float32Array | null = null
let _avgBufLen = 0

function getAvgBuffer(cols: number): Float32Array {
  if (!_avgBuf || _avgBufLen < cols) {
    _avgBufLen = cols
    _avgBuf = new Float32Array(cols)
  } else {
    _avgBuf.fill(0, 0, cols)
  }
  return _avgBuf
}

export function initTextFlow(
  container: HTMLElement,
  prepared: PreparedTextWithSegments,
  font: string,
  lineHeight: number,
  frames: CompactFrame[],
  viewWidth: number,
  viewHeight: number,
  existingPool?: HTMLDivElement[],
): TextFlowState {
  container.style.backgroundColor = BG_COLOR

  const maxLinePositions = Math.ceil(viewHeight / lineHeight)
  const estimatedMax = maxLinePositions * 3

  const pool = existingPool ?? []

  for (let i = 0; i < pool.length; i++) {
    const el = pool[i]!
    el.style.display = 'none'
    el.style.font = font
    el.style.lineHeight = lineHeight + 'px'
  }

  while (pool.length < estimatedMax) {
    const el = document.createElement('div')
    el.className = 'line'
    el.style.font = font
    el.style.lineHeight = lineHeight + 'px'
    el.style.color = FG_COLOR
    el.style.backgroundColor = LINE_BG_COLOR
    el.style.display = 'none'
    container.appendChild(el)
    pool.push(el)
  }

  const n = pool.length
  return {
    container,
    font,
    lineHeight,
    prepared,
    frames,
    viewWidth,
    viewHeight,
    cache: new Array(frames.length),
    pool,
    prevText: new Array<string>(n).fill(''),
    prevX: new Array<number>(n).fill(-1),
    prevY: new Array<number>(n).fill(-1),
    prevW: new Array<number>(n).fill(-1),
    activeCount: 0,
    lastRenderedIndex: -1,
    lineCount: 0,
    charCount: 0,
  }
}

function getOrComputeFrame(state: TextFlowState, index: number): ComputedFrame {
  let cached = state.cache[index]
  if (cached) return cached

  const frame = state.frames[index]!
  const lines = computeFrameLines(
    state.prepared, frame, state.viewWidth, state.viewHeight, state.lineHeight,
  )
  cached = { lines }
  state.cache[index] = cached
  return cached
}

function ensurePoolSize(state: TextFlowState, needed: number): void {
  while (state.pool.length < needed) {
    const el = document.createElement('div')
    el.className = 'line'
    el.style.font = state.font
    el.style.lineHeight = state.lineHeight + 'px'
    el.style.color = FG_COLOR
    el.style.backgroundColor = LINE_BG_COLOR
    el.style.display = 'none'
    state.container.appendChild(el)
    state.pool.push(el)
    state.prevText.push('')
    state.prevX.push(-1)
    state.prevY.push(-1)
    state.prevW.push(-1)
  }
}

function computeFrameLines(
  prepared: PreparedTextWithSegments,
  frame: CompactFrame,
  viewWidth: number,
  viewHeight: number,
  lineHeight: number,
): PositionedLine[] {
  const { grid, cols, rows } = frame
  const cellH = viewHeight / rows
  const cellW = viewWidth / cols
  const lines: PositionedLine[] = []
  let cursor: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 }

  for (let lineY = 0; lineY + lineHeight <= viewHeight; lineY += lineHeight) {
    const gridRowStart = Math.floor(lineY / cellH)
    const gridRowEnd = Math.min(rows - 1, Math.floor((lineY + lineHeight - 1) / cellH))

    const rawSlots = scanSlots(grid, cols, gridRowStart, gridRowEnd, cellW)
    if (rawSlots.length === 0) continue

    const maxRight = viewWidth - SLOT_PADDING_X
    for (let ri = 0; ri < rawSlots.length; ri++) {
      const s = rawSlots[ri]!
      const l = Math.max(SLOT_PADDING_X, s.left)
      const r = Math.min(maxRight, s.right)
      const slotWidth = r - l
      if (slotWidth < MIN_SLOT_PX) continue

      let line = layoutNextLine(prepared, cursor, slotWidth)
      if (line === null) {
        cursor = { segmentIndex: 0, graphemeIndex: 0 }
        line = layoutNextLine(prepared, cursor, slotWidth)
        if (line === null) break
      }

      lines.push({
        x: Math.round(l),
        y: Math.round(lineY),
        text: line.text,
        width: Math.round(slotWidth),
      })
      cursor = line.end
    }
  }

  return lines
}

function scanSlots(
  grid: Uint8Array,
  cols: number,
  rowStart: number,
  rowEnd: number,
  cellW: number,
): Slot[] {
  const rowCount = rowEnd - rowStart + 1
  const avg = getAvgBuffer(cols)

  for (let r = rowStart; r <= rowEnd; r++) {
    const offset = r * cols
    for (let c = 0; c < cols; c++) {
      avg[c] = avg[c]! + grid[offset + c]!
    }
  }

  const slots: Slot[] = []
  let runStart = -1

  for (let c = 0; c < cols; c++) {
    if (avg[c]! / rowCount > BRIGHTNESS_THRESHOLD) {
      if (runStart === -1) runStart = c
    } else {
      if (runStart !== -1) {
        const left = runStart * cellW
        const right = c * cellW
        if (right - left >= MIN_SLOT_PX) {
          slots.push({ left, right })
        }
        runStart = -1
      }
    }
  }

  if (runStart !== -1) {
    const left = runStart * cellW
    const right = cols * cellW
    if (right - left >= MIN_SLOT_PX) {
      slots.push({ left, right })
    }
  }

  if (slots.length > 1) {
    const mergeGap = cellW * 2
    const merged: Slot[] = [slots[0]!]
    for (let i = 1; i < slots.length; i++) {
      const prev = merged[merged.length - 1]!
      const curr = slots[i]!
      if (curr.left - prev.right < mergeGap) {
        prev.right = curr.right
      } else {
        merged.push(curr)
      }
    }
    return merged
  }

  return slots
}

export function renderFrame(state: TextFlowState, frameIndex: number): void {
  if (frameIndex === state.lastRenderedIndex) return

  state.lastRenderedIndex = frameIndex
  const pf = getOrComputeFrame(state, frameIndex)
  const { lines } = pf

  ensurePoolSize(state, lines.length)
  const pool = state.pool
  const { prevText, prevX, prevY, prevW } = state

  for (let i = 0; i < lines.length; i++) {
    const el = pool[i]!
    const line = lines[i]!

    if (i >= state.activeCount) {
      el.style.display = ''
    }

    if (prevText[i] !== line.text) {
      el.textContent = line.text
      prevText[i] = line.text
    }

    if (prevX[i] !== line.x || prevY[i] !== line.y) {
      el.style.transform = `translate(${line.x}px,${line.y}px)`
      prevX[i] = line.x
      prevY[i] = line.y
    }

    if (prevW[i] !== line.width) {
      el.style.width = line.width + 'px'
      prevW[i] = line.width
    }
  }

  for (let i = lines.length; i < state.activeCount; i++) {
    pool[i]!.style.display = 'none'
  }

  state.activeCount = lines.length
  state.lineCount = lines.length
  state.charCount = 0
  for (let i = 0; i < lines.length; i++) {
    state.charCount += lines[i]!.text.length
  }
}
