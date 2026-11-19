// How big one terminal cell is, in screen pixels.
//
// A picture is drawn over a box of cells and stretched to fill it, so to keep
// its shape we must know a cell's width and height. kitty, Ghostty and WezTerm
// report the window's size in pixels on the tty; we divide by rows/columns.

import type { EngineInterface } from 'claude-code'

export type Cell = { width: number; height: number; isMeasured: boolean }

// Used until a measurement comes back, or where the terminal reports no
// pixels: JetBrains Mono 11pt at 1.6 screen scale is about 14 x 31 px.
export const FALLBACK_CELL: Cell = { width: 14, height: 31, isMeasured: false }

const MEASURE_PY = [
  'import fcntl, struct, termios',
  'tty = open("/dev/tty", "rb")',
  'print(*struct.unpack("HHHH", fcntl.ioctl(tty, termios.TIOCGWINSZ, bytes(8))))',
].join('\n')

export async function measureCell($: EngineInterface): Promise<Cell> {
  try {
    const ran = await $.process.run(['python3', '-I', '-c', MEASURE_PY], { timeoutMs: 5000 })
    const [rows = 0, columns = 0, width = 0, height = 0] = ran.stdout.trim().split(/\s+/).map(Number)
    if (ran.exitCode === 0 && rows > 0 && columns > 0 && width > 0 && height > 0) {
      return { width: width / columns, height: height / rows, isMeasured: true }
    }
  } catch {
    // No python3 or no tty: keep the fallback.
  }
  return FALLBACK_CELL
}

// Width / height of one cell: how much taller than wide a cell is.
export const aspectOf = (cell: Cell) => cell.width / cell.height
