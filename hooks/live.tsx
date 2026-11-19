// The live preview: a hidden Chromium (runtime/live-helper.mjs) whose frames
// are drawn in a pane beside the chat, with clicks, keys and the mouse wheel
// sent back to it.
//
//   open()        starts the helper if needed, opens the page, opens the pane
//   drawPane()    the pane: a row of buttons, the picture, the click layer
//   forward()     clicks and keys from the click layer -> the browser
//   wheel()       the mouse wheel over the pane -> the browser
//   stop()        ends the helper (pane closed, or the mod reloaded)

import type { EngineInterface, HookStream, ProcessSpawnChunk, ProcessSpawnResult } from 'claude-code'

import { aspectOf, type Cell } from './cells'
import { nameFromPage, updateEntry } from './gallery'

export const PANE = 'ccglimpse-live'

export type Device = 'desktop' | 'tablet' | 'phone'
export const DEVICES: Record<Device, { width: number; height: number }> = {
  desktop: { width: 1280, height: 800 },
  tablet: { width: 820, height: 1180 },
  phone: { width: 390, height: 844 },
}
export const isDevice = (value: unknown): value is Device =>
  value === 'desktop' || value === 'tablet' || value === 'phone'

// The page's size in CSS pixels and how many screen pixels per CSS pixel.
export type View = { width: number; height: number; scale: number; mobile: boolean }

type Live = {
  target: string // an absolute file path, or a URL
  device: Device
  stream?: HookStream<ProcessSpawnChunk, ProcessSpawnResult>
  socket?: string
  frame?: string // the newest frame's PNG file
  url: string
  title: string
  error?: string
  notice?: string // the last dialog the page raised
  entryId?: string // its gallery entry
  thumbs?: string // the folder for its gallery picture
  thumbAt?: number // when that picture was last taken
  view?: View // the view the browser has now
  wanted?: string // the view last asked for, as JSON
  ack: number // the last click-layer event forwarded
}

// One live preview per session. Module state: a reload of the mod stops the
// helper anyway, so nothing here needs to outlive it.
let live: Live | undefined
let cell: Cell | undefined
let inputs: Promise<unknown> = Promise.resolve()
let blit = { isBusy: false, next: undefined as string | undefined }

export const setCell = (measured: Cell) => {
  cell = measured
}
export const liveState = () => live

// Ties the live page to its gallery entry: the page's title names the entry,
// and a frame every few seconds becomes its picture.
export function setEntry(id: string, thumbs: string) {
  if (live === undefined) return
  live.entryId = id
  live.thumbs = thumbs
  live.thumbAt = 0
}

// Whether the browser still shows the page the gallery entry is for: the same
// file, or the same site for a URL (a dev server moves between its own pages).
function isOnEntryPage(current: Live): boolean {
  const target = current.target
  if (/^https?:/i.test(target)) {
    try {
      return new URL(current.url).origin === new URL(target).origin
    } catch {
      return false
    }
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return current.url === target
  try {
    return decodeURI(current.url.replace(/^file:\/\//, '')) === target
  } catch {
    return false
  }
}

async function saveThumb($: EngineInterface, current: Live, frame: string) {
  const now = Date.now()
  const view = current.view
  if (current.entryId === undefined || current.thumbs === undefined || view === undefined) return
  if (!isOnEntryPage(current)) return
  if (now - (current.thumbAt ?? 0) < 3000) return
  current.thumbAt = now
  const thumb = `${current.thumbs}/${current.entryId}.png`
  const copied = await $.process.run(['cp', '-f', '--', frame, thumb]).catch(() => undefined)
  if (copied?.exitCode === 0) await updateEntry($, current.entryId, { png: thumb, width: view.width, height: view.height })
}

// ---- Talking to the helper ------------------------------------------------------

async function ask($: EngineInterface, path: string, body: unknown = {}) {
  if (live?.socket === undefined) throw new Error('the live preview is not running')
  const response = await $.http.fetch(`http://ccglimpse${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    socketPath: live.socket,
  })
  if (!response.ok) throw new Error(`live preview: ${response.text.slice(0, 300)}`)
  return JSON.parse(response.text || '{}') as Record<string, unknown>
}

// Starts the helper and resolves with its socket once it says "ready".
async function startHelper($: EngineInterface, browser: string, dir: string): Promise<string> {
  const current = live
  if (current === undefined) throw new Error('nothing to show')
  const stream = $.process.spawn({
    argv: ['node', `${$.plugin.root}/runtime/live-helper.mjs`, `--out=${dir}`, `--chrome=${browser}`, '--sweep'],
  })
  current.stream = stream

  return new Promise<string>((resolve, reject) => {
    let buffer = ''
    let isReady = false
    void (async () => {
      try {
        for await (const piece of stream) {
          if (piece.stream !== 'stdout') continue
          buffer += piece.text
          let end = buffer.indexOf('\n')
          while (end >= 0) {
            const line = buffer.slice(0, end)
            buffer = buffer.slice(end + 1)
            end = buffer.indexOf('\n')
            const [word = '', ...rest] = line.split(' ')
            const value = rest.join(' ')
            if (word === 'ready') {
              isReady = true
              resolve(value)
            } else if (word === 'frame') {
              current.frame = rest[1]
              showFrame($)
              if (current.frame !== undefined) void saveThumb($, current, current.frame)
            } else if (word === 'url') {
              current.url = value
              current.notice = undefined
              $.ui.invalidate('ui.render')
            } else if (word === 'title') {
              current.title = value
              if (current.entryId !== undefined && isOnEntryPage(current)) void nameFromPage($, current.entryId, value)
              $.ui.invalidate('ui.render')
            } else if (word === 'dialog') {
              current.notice = `The page said: ${value}`
              $.ui.invalidate('ui.render')
            } else if (word === 'error') {
              current.error = value
              if (!isReady) reject(new Error(value))
              $.ui.invalidate('ui.render')
            }
          }
        }
      } catch (error) {
        if (!isReady) reject(error instanceof Error ? error : new Error(String(error)))
      }
      // The helper ended.
      if (live === current) {
        current.socket = undefined
        current.stream = undefined
        current.error ??= 'The preview stopped.'
        $.ui.invalidate('ui.render')
      }
      if (!isReady) reject(new Error('the live preview helper stopped before it was ready'))
    })()
  })
}

// Swaps the newest frame into the picture: one swap in flight, newest wins.
async function showFrame($: EngineInterface) {
  const frame = live?.frame
  if (frame === undefined) return
  blit.next = frame
  if (blit.isBusy) return
  blit.isBusy = true
  try {
    while (blit.next !== undefined) {
      const source = blit.next
      blit.next = undefined
      const result = await $.ui.blit({ requestId: PANE, key: 'view', source: { file: source, format: 'png' } })
      if (result.deny !== undefined) {
        // Not drawn yet, or drawn at another size: a redraw shows the newest.
        $.ui.invalidate('ui.render')
        break
      }
    }
  } finally {
    blit.isBusy = false
  }
}

// ---- Opening and stopping -------------------------------------------------------

export async function openLive(
  $: EngineInterface,
  request: { target: string; device: Device; browser: string; dir: string },
): Promise<{ isPlaced: boolean; reason?: string }> {
  const isRunning = live?.socket !== undefined
  if (!isRunning) {
    live = { target: request.target, device: request.device, url: '', title: '', ack: 0 }
    blit = { isBusy: false, next: undefined }
    live.socket = await startHelper($, request.browser, request.dir)
  }
  const current = live as Live
  current.target = request.target
  current.device = request.device
  current.error = undefined
  current.wanted = undefined

  const opened = await $.ui.open({ id: PANE, title: 'Live preview' })
  // Open at the device's own size first; the pane's first draw then fits it.
  const view = viewFor(current.device, undefined)
  current.view = view
  await ask($, '/open', { ...view, target: current.target })
  $.ui.invalidate('ui.render')
  return opened.isPlaced ? { isPlaced: true } : { isPlaced: false, reason: opened.reason }
}

export async function stopLive($: EngineInterface) {
  const current = live
  if (current === undefined) return
  // Ask the helper to quit (it stops its browser), then end the stream.
  await ask($, '/quit').catch(() => undefined)
  live = undefined
  await current.stream?.return(undefined as never).catch(() => undefined)
}

export async function reloadLive($: EngineInterface) {
  await ask($, '/reload')
}

// The address bar: a file path or a URL, in the page already open.
export async function navigateLive($: EngineInterface, target: string) {
  if (live === undefined) return
  live.target = target
  await ask($, '/navigate', { target })
}

export async function historyLive($: EngineInterface, direction: 'back' | 'forward') {
  await ask($, `/${direction}`)
}

export async function setDevice($: EngineInterface, device: Device) {
  if (live === undefined) return
  live.device = device
  live.wanted = undefined
  $.ui.invalidate('ui.render')
}

// ---- Sizes --------------------------------------------------------------------

// The picture's box in cells for this pane, and the page size that fills it.
function layout(device: Device, room: { columns: number; rows: number }) {
  const known = cell ?? { width: 14, height: 31, isMeasured: false }
  const aspect = aspectOf(known)
  const natural = DEVICES[device]
  const rows = Math.max(4, room.rows)
  let columns = room.columns
  if (device !== 'desktop') {
    // A phone or tablet keeps its own shape, centred.
    columns = Math.min(room.columns, Math.round((rows * natural.width) / natural.height / aspect))
  }
  columns = Math.max(10, columns)
  const view: View = {
    width: natural.width,
    height: Math.round((natural.width * rows * known.height) / (columns * known.width)),
    // Enough screen pixels for the box, never more than 2x.
    scale: Math.min(2, Math.max(0.5, (columns * known.width) / natural.width)),
    mobile: device !== 'desktop',
  }
  return { columns, rows, view }
}

function viewFor(device: Device, room: { columns: number; rows: number } | undefined): View {
  if (room === undefined) {
    const natural = DEVICES[device]
    return { width: natural.width, height: natural.height, scale: 1, mobile: device !== 'desktop' }
  }
  return layout(device, room).view
}

// ---- Input ----------------------------------------------------------------------

type Posted = {
  id: number
  type: 'down' | 'up' | 'move' | 'key'
  fx: number
  fy: number
  button?: string
  key?: string
  ctrl?: true
  shift?: true
  meta?: true
}

// Clicks and keys from the click layer. Answers the layer's next props: the
// last event taken, so it can forget those.
export function forward($: EngineInterface, data: unknown): { ack: number } {
  const current = live
  if (current === undefined || current.view === undefined) return { ack: 0 }
  const posted = (data as { events?: Posted[] } | undefined)?.events ?? []
  const fresh = posted.filter(event => event.id > current.ack)
  if (fresh.length === 0) return { ack: current.ack }
  current.ack = fresh[fresh.length - 1]?.id ?? current.ack
  const view = current.view
  const events = fresh.map(event => ({
    type: event.type,
    x: event.fx * view.width,
    y: event.fy * view.height,
    button: event.button,
    key: event.key,
    ctrl: event.ctrl,
    shift: event.shift,
    meta: event.meta,
  }))
  // In order, one request after another.
  inputs = inputs.then(() => ask($, '/input', { events })).catch(() => undefined)
  return { ack: current.ack }
}

// The mouse wheel over the pane, at a cell of its body.
export function wheel($: EngineInterface, by: number, at: { column: number; row: number } | undefined, box: { columns: number; rows: number; top: number; left: number }) {
  const current = live
  if (current?.view === undefined) return
  const view = current.view
  const fx = at === undefined ? 0.5 : (at.column - box.left + 0.5) / box.columns
  const fy = at === undefined ? 0.5 : (at.row - box.top + 0.5) / box.rows
  const events = [{ type: 'wheel', x: Math.min(1, Math.max(0, fx)) * view.width, y: Math.min(1, Math.max(0, fy)) * view.height, dy: by }]
  inputs = inputs.then(() => ask($, '/input', { events })).catch(() => undefined)
}

// ---- Drawing the pane -----------------------------------------------------------

// Where the picture sits in the pane's body: two rows above it (the address
// bar, then the buttons), one line of status below it.
export const HEADER_ROWS = 2
export const FOOTER_ROWS = 1

export function paneBox(bodyColumns: number, bodyRows: number) {
  const current = live
  const room = { columns: bodyColumns, rows: Math.max(4, bodyRows - HEADER_ROWS - FOOTER_ROWS) }
  const { columns, rows, view } = layout(current?.device ?? 'desktop', room)
  const left = Math.max(0, Math.floor((bodyColumns - columns) / 2))
  return { columns, rows, view, left, top: HEADER_ROWS }
}

// Asks the browser for the page size this box needs, when it changed.
export function fitBrowser($: EngineInterface, view: View) {
  const current = live
  if (current?.socket === undefined) return
  const wanted = JSON.stringify(view)
  if (current.wanted === wanted) return
  current.wanted = wanted
  void ask($, '/viewport', view)
    .then(() => {
      if (live === current) current.view = view
    })
    .catch(() => {
      if (live === current) current.wanted = undefined
    })
}
