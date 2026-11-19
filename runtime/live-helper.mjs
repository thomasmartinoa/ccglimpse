// Live preview helper for the CCGlimpse plugin.
//
// Runs one hidden Chromium, saves every new frame of the page as a PNG file,
// and takes clicks, keys and scrolls from the mod over a Unix socket.
//
// It talks to the mod in two ways:
//   stdout   one line per event:  ready <socket> | frame <n> <path> | url <url> | title <t>
//            | dialog <type>: <message> | error <msg>
//   socket   HTTP requests on <out>/helper.sock:
//            POST /open      { target, width, height, scale, mobile }
//            POST /navigate  { target }                 (the address bar)
//            POST /viewport  { width, height, scale, mobile }
//            POST /input     { events: [...] }   (see dispatch() below)
//            POST /reload, /back, /forward
//            GET  /state
//
// Usage: node live-helper.mjs --out=<folder> [--chrome=chromium] [--sweep]
//
// Each session has its own <out> folder (frames, browser profile, socket), so
// sessions running at once never touch each other's browser. --sweep removes
// the folders next to <out> that were left by helpers that are gone.

import { execFileSync, spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, statSync, watch, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

// ---- Step 0: read the arguments -------------------------------------------

const args = {}
for (const arg of process.argv.slice(2)) {
  const [key, ...rest] = arg.replace(/^--/, '').split('=')
  args[key] = rest.join('=')
}
if (!args.out) {
  console.error('usage: node live-helper.mjs --out=<folder> [--chrome=chromium]')
  process.exit(2)
}
const OUT = args.out
const FRAMES = join(OUT, 'frames')
const PROFILE = join(OUT, 'profile')
const CHROME = args.chrome || 'chromium'
// A Unix socket path must stay under ~108 bytes. Use the private runtime
// folder when the out folder's path is too long.
const SOCKET = (() => {
  if (args.socket) return args.socket
  const inOut = join(OUT, 'helper.sock')
  if (Buffer.byteLength(inOut) < 100) return inOut
  return join(process.env.XDG_RUNTIME_DIR || '/tmp', `ccglimpse-${process.pid}.sock`)
})()

const say = line => process.stdout.write(`${line.replace(/\n/g, ' ')}\n`)

// First of all, say this folder is in use, so a sweep by another session
// leaves it alone.
mkdirSync(FRAMES, { recursive: true, mode: 0o700 })
writeFileSync(join(OUT, 'helper.pid'), String(process.pid))
for (const name of readdirSync(FRAMES)) rmSync(join(FRAMES, name), { force: true })
rmSync(SOCKET, { force: true })

// The command line of a running process, or '' when there is none.
function commandOf(pid) {
  if (!(pid > 1)) return ''
  try {
    return execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

// Waits, up to `ms`, for a process to be gone.
function waitGone(pid, ms) {
  const until = Date.now() + ms
  while (commandOf(pid) !== '' && Date.now() < until) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50)
}

// A browser left over from a helper that was killed hard still holds its
// profile. The profile's lock names it as "<host>-<pid>". Stop it, but only
// when that process really is a browser using this profile, and wait until
// it is gone, since it keeps writing to the profile while it stops.
function stopLeftoverBrowser(profile) {
  try {
    const lock = readlinkSync(join(profile, 'SingletonLock'))
    const cut = lock.lastIndexOf('-')
    const pid = Number(lock.slice(cut + 1))
    if (lock.slice(0, cut) !== hostname() || !commandOf(pid).includes(profile)) return
    process.kill(pid, 'SIGKILL')
    waitGone(pid, 3000)
  } catch {}
}

// Removes the folders next to ours whose helper is gone: a closed session, a
// crash. A folder whose helper.pid is missing is only removed once it is an
// hour old, in case its helper is starting right now. It runs once this
// helper is ready, so it never holds up the start.
function sweep(parent) {
  let names = []
  try { names = readdirSync(parent, { withFileTypes: true }) } catch { return }
  for (const one of names) {
    const folder = join(parent, one.name)
    if (folder === OUT || !one.isDirectory()) continue
    try {
      let pid = 0
      try { pid = Number(readFileSync(join(folder, 'helper.pid'), 'utf8')) } catch {}
      if (pid > 1 && commandOf(pid).includes(folder)) continue
      if (!(pid > 1) && Date.now() - statSync(folder).mtimeMs < 3600_000) continue
      stopLeftoverBrowser(join(folder, 'profile'))
      rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    } catch {}
  }
}

stopLeftoverBrowser(PROFILE)

// ---- Step 1: start Chromium and connect to its page -----------------------

const browser = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-port=0',
    '--remote-allow-origins=*',
    `--user-data-dir=${PROFILE}`,
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'pipe'] },
)

function stop(code = 0) {
  try { browser.kill('SIGKILL') } catch {}
  try { rmSync(SOCKET, { force: true }) } catch {}
  process.exit(code)
}
process.on('SIGTERM', () => stop(0))
process.on('SIGINT', () => stop(0))
process.on('SIGHUP', () => stop(0))
// Never leave the browser running behind a crash.
process.on('exit', () => { try { browser.kill('SIGKILL') } catch {} })
process.on('uncaughtException', error => { say(`error ${error?.message ?? error}`); stop(1) })
// If the mod's process dies without telling us, we become an orphan: stop.
const parent = process.ppid
setInterval(() => { if (process.ppid !== parent) stop(0) }, 2000).unref()

const browserUrl = await new Promise((resolve, reject) => {
  let seen = ''
  browser.stderr.on('data', chunk => {
    seen += chunk
    const match = /DevTools listening on (ws:\/\/\S+)/.exec(seen)
    if (match) resolve(match[1])
  })
  browser.on('exit', code => reject(new Error(`${CHROME} exited with ${code}: ${seen.slice(-300)}`)))
  setTimeout(() => reject(new Error(`${CHROME} did not start in 20 s`)), 20000)
}).catch(error => {
  say(`error ${error.message}`)
  stop(1)
})
browser.on('exit', () => { say('error the browser stopped'); stop(1) })

const port = new URL(browserUrl).port
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const pageTarget = targets.find(t => t.type === 'page')
const cdp = await connect(pageTarget.webSocketDebuggerUrl)

// A tiny Chrome DevTools Protocol client: send(method, params) and on(event, fn).
function connect(url) {
  const socket = new WebSocket(url)
  const waiting = new Map()
  const listeners = new Map()
  let lastId = 0
  socket.onmessage = message => {
    const data = JSON.parse(message.data)
    if (data.id !== undefined) {
      const call = waiting.get(data.id)
      waiting.delete(data.id)
      if (data.error) call?.reject(new Error(data.error.message))
      else call?.resolve(data.result)
    } else {
      listeners.get(data.method)?.(data.params)
    }
  }
  socket.onclose = () => { say('error the browser connection closed'); stop(1) }
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      lastId += 1
      waiting.set(lastId, { resolve, reject })
      socket.send(JSON.stringify({ id: lastId, method, params }))
    })
  const on = (method, fn) => listeners.set(method, fn)
  return new Promise((resolve, reject) => {
    socket.onopen = () => resolve({ send, on })
    socket.onerror = () => reject(new Error('cannot connect to the browser'))
  })
}

// ---- Step 2: stream frames as PNG files ------------------------------------

const view = { width: 1280, height: 800, scale: 2, mobile: false }
let frameNumber = 0
let latestFrame = ''
let currentUrl = 'about:blank'
let currentTitle = ''

cdp.on('Page.screencastFrame', ({ data, sessionId }) => {
  cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
  frameNumber += 1
  const file = join(FRAMES, `frame-${frameNumber}.png`)
  writeFileSync(file, Buffer.from(data, 'base64'))
  latestFrame = file
  say(`frame ${frameNumber} ${file}`)
  // The terminal reads a frame file a moment after it is named: keep a few.
  rmSync(join(FRAMES, `frame-${frameNumber - 12}.png`), { force: true })
})

cdp.on('Page.frameNavigated', ({ frame }) => {
  if (frame.parentId) return
  currentUrl = frame.url
  say(`url ${currentUrl}`)
})
cdp.on('Page.loadEventFired', async () => {
  const result = await cdp.send('Runtime.evaluate', { expression: 'document.title' }).catch(() => undefined)
  currentTitle = result?.result?.value ?? ''
  say(`title ${currentTitle}`)
})

await cdp.send('Page.enable')
await cdp.send('Runtime.enable')

// One page only: links and window.open that would make a new tab open here.
await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    window.open = function (url) { if (url) location.href = url; return null };
    document.addEventListener('click', event => {
      const link = event.target && event.target.closest && event.target.closest('a[target]');
      if (link && link.target !== '_self') link.target = '_self';
    }, true);
  `,
})

// A dialog (alert, confirm, prompt) would freeze a hidden page: answer it
// and say what it said.
cdp.on('Page.javascriptDialogOpening', ({ message, type }) => {
  say(`dialog ${type}: ${message}`)
  cdp.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {})
})

async function setViewport(next) {
  for (const key of ['width', 'height', 'scale']) {
    if (typeof next[key] === 'number' && next[key] > 0) view[key] = next[key]
  }
  if (typeof next.mobile === 'boolean') view.mobile = next.mobile
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: Math.round(view.width),
    height: Math.round(view.height),
    deviceScaleFactor: view.scale,
    mobile: view.mobile,
  })
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: view.mobile })
  // Restart the stream so frames come at the new size, and one comes at once.
  await cdp.send('Page.stopScreencast').catch(() => {})
  await cdp.send('Page.startScreencast', {
    format: 'png',
    maxWidth: Math.round(view.width * view.scale),
    maxHeight: Math.round(view.height * view.scale),
    everyNthFrame: 1,
  })
}

// ---- Step 3: open pages, and reload a local file when it changes ----------

let watcher
async function open(target) {
  watcher?.close()
  watcher = undefined
  let url = target
  if (!/^[a-z][a-z0-9+.-]*:/i.test(target)) {
    // A file path. Watch its folder (editors often replace the file).
    statSync(target)
    url = pathToFileURL(target).href
    let timer
    watcher = watch(dirname(target), (_, name) => {
      if (name !== basename(target)) return
      clearTimeout(timer)
      timer = setTimeout(() => cdp.send('Page.reload').catch(() => {}), 150)
    })
  }
  await cdp.send('Page.navigate', { url })
}

// ---- Step 4: clicks, keys and scrolls --------------------------------------

const BUTTON_BITS = { left: 1, right: 2, middle: 4 }
const MODIFIERS = event => (event.alt ? 1 : 0) | (event.ctrl ? 2 : 0) | (event.meta ? 4 : 0) | (event.shift ? 8 : 0)
// Terminal key names -> [DOM key, Windows key code, text it types]
const SPECIAL_KEYS = {
  return: ['Enter', 13, '\r'],
  enter: ['Enter', 13, '\r'],
  tab: ['Tab', 9, ''],
  backspace: ['Backspace', 8, ''],
  delete: ['Delete', 46, ''],
  escape: ['Escape', 27, ''],
  up: ['ArrowUp', 38, ''],
  down: ['ArrowDown', 40, ''],
  left: ['ArrowLeft', 37, ''],
  right: ['ArrowRight', 39, ''],
  home: ['Home', 36, ''],
  end: ['End', 35, ''],
  pageup: ['PageUp', 33, ''],
  pagedown: ['PageDown', 34, ''],
  space: [' ', 32, ' '],
}
let heldButton = 'none'

async function dispatch(event) {
  const x = Math.max(0, event.x ?? 0)
  const y = Math.max(0, event.y ?? 0)
  switch (event.type) {
    case 'down':
      heldButton = event.button ?? 'left'
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mousePressed', x, y, button: heldButton, buttons: BUTTON_BITS[heldButton], clickCount: 1,
      })
      break
    case 'up':
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased', x, y, button: event.button ?? heldButton, buttons: 0, clickCount: 1,
      })
      heldButton = 'none'
      break
    case 'move':
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved', x, y, button: heldButton, buttons: BUTTON_BITS[heldButton] ?? 0,
      })
      break
    case 'wheel':
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseWheel', x, y, deltaX: 0, deltaY: (event.dy ?? 0) * 60,
      })
      break
    case 'key': {
      const key = String(event.key ?? '')
      const special = SPECIAL_KEYS[key.toLowerCase()]
      const modifiers = MODIFIERS(event)
      if (special) {
        const [domKey, code, text] = special
        await cdp.send('Input.dispatchKeyEvent', {
          type: text ? 'keyDown' : 'rawKeyDown', key: domKey, windowsVirtualKeyCode: code, text, modifiers,
        })
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: domKey, windowsVirtualKeyCode: code, modifiers })
      } else if (key.length === 1) {
        const upper = key.toUpperCase()
        const code = upper >= 'A' && upper <= 'Z' ? upper.charCodeAt(0) : 0
        await cdp.send('Input.dispatchKeyEvent', {
          type: 'keyDown', key, text: event.ctrl || event.meta ? '' : key, windowsVirtualKeyCode: code, modifiers,
        })
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, windowsVirtualKeyCode: code, modifiers })
      } else if (key.length > 1) {
        // Several characters typed at once (a paste or a fast burst).
        await cdp.send('Input.insertText', { text: key })
      }
      break
    }
  }
}

// ---- Step 5: the socket the mod talks to -----------------------------------

const readBody = request =>
  new Promise(resolve => {
    let body = ''
    request.on('data', chunk => { body += chunk })
    request.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}) } catch { resolve({}) }
    })
  })

const server = createServer(async (request, response) => {
  const reply = (status, data) => {
    response.writeHead(status, { 'content-type': 'application/json' })
    response.end(JSON.stringify(data))
  }
  try {
    const body = await readBody(request)
    switch (request.url) {
      case '/open':
        await setViewport(body)
        await open(String(body.target))
        return reply(200, { ok: true })
      case '/viewport':
        await setViewport(body)
        return reply(200, { ok: true })
      case '/navigate':
        await open(String(body.target))
        return reply(200, { ok: true })
      case '/input':
        for (const event of body.events ?? []) await dispatch(event)
        return reply(200, { ok: true })
      case '/reload':
        await cdp.send('Page.reload')
        return reply(200, { ok: true })
      case '/back':
      case '/forward': {
        const { currentIndex, entries } = await cdp.send('Page.getNavigationHistory')
        const entry = entries[currentIndex + (request.url === '/back' ? -1 : 1)]
        if (entry) await cdp.send('Page.navigateToHistoryEntry', { entryId: entry.id })
        return reply(200, { ok: Boolean(entry) })
      }
      case '/state':
        return reply(200, { url: currentUrl, title: currentTitle, frame: latestFrame, view })
      case '/quit':
        reply(200, { ok: true })
        return setTimeout(() => stop(0), 50)
      default:
        return reply(404, { error: 'unknown request' })
    }
  } catch (error) {
    return reply(500, { error: String(error?.message ?? error) })
  }
})

server.listen(SOCKET, () => {
  say(`ready ${SOCKET}`)
  if ('sweep' in args) setTimeout(() => sweep(dirname(OUT)), 100)
})
