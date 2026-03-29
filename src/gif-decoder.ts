import { parseGIF, decompressFrames } from "gifuct-js";

export type CompactFrame = {
  grid: Uint8Array;
  cols: number;
  rows: number;
};

export type GifSequencer = {
  frames: CompactFrame[];
  totalDuration: number;
  gifWidth: number;
  gifHeight: number;
  getFrameIndexAt(elapsed: number): number;
};

const YIELD_INTERVAL = 30;
const BLUR_RADIUS = 2;

function yieldToMain(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

export async function decodeGif(
  url: string,
  gridCols: number,
  gridRows: number,
): Promise<{
  frames: CompactFrame[];
  delays: number[];
  gifWidth: number;
  gifHeight: number;
}> {
  const resp = await fetch(url);
  const buffer = await resp.arrayBuffer();
  const gif = parseGIF(buffer);
  const rawFrames = decompressFrames(gif, true);

  if (rawFrames.length === 0) throw new Error("GIF has no frames");

  const gifWidth = gif.lsd.width;
  const gifHeight = gif.lsd.height;

  const compositeCanvas = new OffscreenCanvas(gifWidth, gifHeight);
  const compositeCtx = compositeCanvas.getContext("2d")!;

  const frames: CompactFrame[] = [];
  const delays: number[] = [];

  for (let i = 0; i < rawFrames.length; i++) {
    const raw = rawFrames[i]!;

    const frameCanvas = new OffscreenCanvas(raw.dims.width, raw.dims.height);
    const frameCtx = frameCanvas.getContext("2d")!;
    const frameImageData = frameCtx.createImageData(
      raw.dims.width,
      raw.dims.height,
    );
    frameImageData.data.set(raw.patch);
    frameCtx.putImageData(frameImageData, 0, 0);

    if (raw.disposalType === 2) {
      compositeCtx.clearRect(0, 0, gifWidth, gifHeight);
    }

    compositeCtx.drawImage(frameCanvas, raw.dims.left, raw.dims.top);

    const snapshot = compositeCtx.getImageData(0, 0, gifWidth, gifHeight);
    const grid = downsampleToGrid(
      snapshot.data,
      gifWidth,
      gifHeight,
      gridCols,
      gridRows,
    );
    blurGrid(grid, gridCols, gridRows, BLUR_RADIUS);

    frames.push({ grid, cols: gridCols, rows: gridRows });
    delays.push(raw.delay * 10);

    if (frames.length % YIELD_INTERVAL === 0) {
      await yieldToMain();
    }
  }

  return { frames, delays, gifWidth, gifHeight };
}

function downsampleToGrid(
  data: Uint8ClampedArray,
  imgW: number,
  imgH: number,
  cols: number,
  rows: number,
): Uint8Array {
  const grid = new Uint8Array(cols * rows);
  const cellW = imgW / cols;
  const cellH = imgH / rows;
  const samplesX = Math.max(1, Math.min(4, (cellW / 2) | 0));
  const samplesY = Math.max(1, Math.min(4, (cellH / 2) | 0));
  const totalSamples = samplesX * samplesY;

  for (let r = 0; r < rows; r++) {
    const cellTop = r * cellH;
    for (let c = 0; c < cols; c++) {
      const cellLeft = c * cellW;
      let sum = 0;

      for (let sy = 0; sy < samplesY; sy++) {
        const py = Math.min(
          imgH - 1,
          (cellTop + ((sy + 0.5) * cellH) / samplesY) | 0,
        );
        for (let sx = 0; sx < samplesX; sx++) {
          const px = Math.min(
            imgW - 1,
            (cellLeft + ((sx + 0.5) * cellW) / samplesX) | 0,
          );
          const i = (py * imgW + px) * 4;
          sum += (data[i]! + data[i + 1]! + data[i + 2]!) / 3;
        }
      }

      grid[r * cols + c] = (sum / totalSamples) | 0;
    }
  }

  return grid;
}

function blurGrid(
  grid: Uint8Array,
  cols: number,
  rows: number,
  radius: number,
): void {
  const tmp = new Uint8Array(cols * rows);
  const diam = radius * 2 + 1;

  for (let r = 0; r < rows; r++) {
    const off = r * cols;
    let sum = 0;
    for (let c = -radius; c <= radius; c++) {
      sum += grid[off + Math.max(0, Math.min(cols - 1, c))]!;
    }
    tmp[off] = (sum / diam) | 0;
    for (let c = 1; c < cols; c++) {
      sum +=
        grid[off + Math.min(cols - 1, c + radius)]! -
        grid[off + Math.max(0, c - radius - 1)]!;
      tmp[off + c] = (sum / diam) | 0;
    }
  }

  for (let c = 0; c < cols; c++) {
    let sum = 0;
    for (let r = -radius; r <= radius; r++) {
      sum += tmp[Math.max(0, Math.min(rows - 1, r)) * cols + c]!;
    }
    grid[c] = (sum / diam) | 0;
    for (let r = 1; r < rows; r++) {
      sum +=
        tmp[Math.min(rows - 1, r + radius) * cols + c]! -
        tmp[Math.max(0, r - radius - 1) * cols + c]!;
      grid[r * cols + c] = (sum / diam) | 0;
    }
  }
}

const MAX_FRAME_DELAY = 80;
const MIN_FRAME_DELAY = 16;

export function createSequencer(
  frames: CompactFrame[],
  delays: number[],
  gifWidth: number,
  gifHeight: number,
): GifSequencer {
  const cumulativeEnds: number[] = [];
  let totalDuration = 0;

  for (let i = 0; i < frames.length; i++) {
    const raw = delays[i] ?? 100;
    const clamped = Math.max(MIN_FRAME_DELAY, Math.min(raw, MAX_FRAME_DELAY));
    totalDuration += clamped;
    cumulativeEnds.push(totalDuration);
  }

  if (totalDuration === 0) {
    totalDuration = frames.length * 60;
    for (let i = 0; i < frames.length; i++) {
      cumulativeEnds[i] = (i + 1) * 60;
    }
  }

  function getFrameIndexAt(elapsed: number): number {
    const loopTime = elapsed % totalDuration;
    let lo = 0;
    let hi = cumulativeEnds.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cumulativeEnds[mid]! <= loopTime) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  return { frames, totalDuration, gifWidth, gifHeight, getFrameIndexAt };
}
