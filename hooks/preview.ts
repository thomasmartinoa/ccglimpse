// Still pictures: HTML in, PNG out, and how many cells the PNG covers.

import type { EngineInterface, RenderViewport } from 'claude-code'

import { aspectOf, type Cell } from './cells'

export type Size = 'sketch' | 'full'

// A sketch takes about the room an ASCII sketch would: small and inline.
export const SKETCH_BOX = { columns: 64, rows: 16 }

// Browsers to try, in order, for the headless screenshot.
const BROWSERS = ['chromium', 'google-chrome-stable', 'google-chrome', 'brave', 'chrome']

// The first browser on this machine that answers --version.
export async function findBrowser($: EngineInterface): Promise<string | undefined> {
  for (const browser of BROWSERS) {
    const ran = await $.process.run([browser, '--version'], { timeoutMs: 10_000 }).catch(() => undefined)
    if (ran?.exitCode === 0) return browser
  }
  return undefined
}

// Screenshots `page` (an absolute file path) into `png`.
// Returns undefined on success, else what went wrong.
export async function screenshot(
  $: EngineInterface,
  shot: { browser: string; page: string; png: string; profile: string; width: number; height: number; scale: number },
): Promise<string | undefined> {
  const ran = await $.process
    .run(
      [
        shot.browser,
        '--headless=new',
        '--disable-gpu',
        '--hide-scrollbars',
        '--no-first-run',
        '--no-default-browser-check',
        `--user-data-dir=${shot.profile}`,
        `--force-device-scale-factor=${shot.scale}`,
        '--virtual-time-budget=3000',
        `--window-size=${shot.width},${shot.height}`,
        `--screenshot=${shot.png}`,
        `file://${shot.page}`,
      ],
      { timeoutMs: 60_000 },
    )
    .catch((error: unknown) => ({ exitCode: -1, stderr: String(error), stdout: '' }))
  if (ran.exitCode === 0 && (await $.fs.exists(shot.png))) return undefined
  return `${shot.browser} failed (exit ${ran.exitCode}): ${ran.stderr.slice(-500)}`
}

// ---- The result line ------------------------------------------------------
// The tool's result text carries the PNG's path, size and kind. The drawing
// hook reads them back from it, so a resumed session still draws the picture.

export type Shot = { png: string; width: number; height: number; size: Size; page: string }

export const resultLine = (shot: Shot) =>
  `PNG: ${shot.png} (${shot.width}x${shot.height}, ${shot.size}) from ${shot.page}`

const RESULT_PATTERN = /PNG: (\S+\.png) \((\d+)x(\d+)(?:, (sketch|full))?\) from (\S+)/

export function readShot(output: unknown): Shot | undefined {
  if (typeof output !== 'string') return undefined
  const match = RESULT_PATTERN.exec(output)
  if (match === null) return undefined
  const [, png = '', width = '0', height = '0', size = 'full', page = ''] = match
  return { png, width: Number(width), height: Number(height), size: size === 'sketch' ? 'sketch' : 'full', page }
}

// ---- Fitting a picture to cells ---------------------------------------------

// The largest box of cells inside `room` with the picture's own shape.
export function fitToCells(
  picture: { width: number; height: number },
  room: { columns: number; rows: number },
  cell: Cell,
) {
  const aspect = aspectOf(cell)
  const rowsFor = (columns: number) => (columns * picture.height * aspect) / picture.width
  let columns = room.columns
  let rows = rowsFor(columns)
  if (rows > room.rows) {
    rows = room.rows
    columns = (rows * picture.width) / (picture.height * aspect)
  }
  return {
    columns: Math.min(255, Math.max(1, Math.round(columns))),
    rows: Math.min(255, Math.max(1, Math.round(rows))),
  }
}

// How much room a still picture may take in the transcript.
export function roomFor(size: Size, viewport: RenderViewport | undefined) {
  const columns = Math.max(20, (viewport?.columns ?? 100) - 4)
  const rows = Math.max(8, (viewport?.rows ?? 40) - 8)
  if (size === 'sketch') {
    return { columns: Math.min(columns, SKETCH_BOX.columns), rows: Math.min(rows, SKETCH_BOX.rows) }
  }
  return { columns, rows }
}

export const clampNumber = (value: unknown, fallback: number, low: number, high: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(high, Math.max(low, Math.round(value))) : fallback
