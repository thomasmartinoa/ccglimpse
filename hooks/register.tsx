// CCGlimpse: see UI right in the terminal.
//
//   mcp__ccglimpse__preview   HTML -> a still picture in the chat
//                             (size "sketch": small, the room of an ASCII sketch;
//                              size "full": as wide as the chat)
//   mcp__ccglimpse__live      a live, clickable page in a pane beside the chat,
//                             and the gallery of everything shown so far
//   /view                     the gallery; /view <file|url> [device] the live pane
//
// It also tells Claude when to show things here and when to ask about an
// artifact instead (ROUTING below).

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { GlimpseLive } from '../types'
import { FALLBACK_CELL, measureCell, type Cell } from './cells'
import { forget, loadGallery, remember, titleOf, updateEntry, type Entry, type EntryKind } from './gallery'
import { drawGallery, GALLERY, type GalleryView } from './gallery-pane'
import {
  PANE,
  type Device,
  fitBrowser,
  forward,
  historyLive,
  isDevice,
  liveState,
  navigateLive,
  openLive,
  paneBox,
  reloadLive,
  setCell,
  setDevice,
  setEntry,
  stopLive,
  wheel,
} from './live'
import { clampNumber, findBrowser, fitToCells, readShot, resultLine, roomFor, screenshot, type Size } from './preview'

const PREVIEW = 'mcp__ccglimpse__preview'
const LIVE = 'mcp__ccglimpse__live'

// claude.ai artifact links, and claude.ai itself.
const ARTIFACT_LINK = /https:\/\/claude\.ai\/(?:code\/)?artifact\/[\w-]+/
const CLAUDE_AI = /^https?:\/\/([\w-]+\.)*claude\.ai(\/|$)/i

// ---- What Claude reads ------------------------------------------------------

const ROUTING = `# Showing UI to the user (CCGlimpse plugin)

The user's terminal shows real pictures (kitty graphics), and they want to SEE layouts, not read drawings made of characters.

- Never draw a UI layout, wireframe, screen or component sketch with ASCII or box-drawing characters. Write it as HTML and show it with ${PREVIEW}.
  - size "sketch": a small picture, about the room an ASCII sketch takes. Use it for quick layout ideas, how parts sit on a screen, comparing 2-3 options, or the screens of a flow, inline in your answer. Keep sketches low-fidelity: grey boxes, labels, little text.
  - size "full": a detailed mockup or a whole screen the user should review.
  - Give each one a short \`title\`: it names it in the gallery.
- When the user wants to click through a flow, try an interaction, or watch a page they are building (an HTML file, or a dev server such as http://localhost:5173), use ${LIVE}. It opens a live, clickable page in a pane beside the chat; editing its file reloads it. Call it with action "look" to see what the user sees there now.
- Everything shown is kept in a gallery across sessions. When the user wants to see or pick from earlier sketches, mockups or pages, call ${LIVE} with action "gallery" (they can also run /view).
- Artifacts in the terminal:
  - An artifact you publish from a local .html file can be shown here: call ${LIVE} with that \`file\` (its row also gets a "view here" button).
  - For an existing artifact link: read it with the Artifact tool (action "read", path "index.html", and \`paths\` for any other files it loads), then call ${LIVE} with the saved index.html as \`file\` and the link as \`link\`. This works for plain HTML artifacts.
  - Artifacts made from an Artifact type (Docs, Slides, Dashboard, Design and the like) are apps that run only on claude.ai, and claude.ai does not serve the plugin's headless browser. Say they cannot be shown in the terminal and give the user the link.
- Terminal or artifact:
  - Small and medium visuals for the user's own review while working (a component, a screen, a short flow, layout options): show them in the terminal without asking.
  - When the user explicitly mentions an artifact, ask with AskUserQuestion whether they want it in the terminal or as an artifact, unless they already said which.
  - For large work (a multi-page site, a full design system, a large dashboard, anything meant for other people or to keep), ask with AskUserQuestion before building it: terminal or artifact, recommending the artifact.`

const PREVIEW_DESCRIPTION = `Render HTML with a headless browser and show it to the user as a real picture, inline in the chat in their terminal. It is kept in the user's gallery.

Use this INSTEAD of drawing layouts with ASCII or box-drawing characters.

- \`size\`: "sketch" for a small inline picture (about the room an ASCII sketch takes: quick layout ideas, options side by side, flow overviews; keep it low-fidelity) or "full" for a detailed mockup the user should review (default).
- Pass \`html\` (one self-contained page; inline CSS is best, a CDN script such as Tailwind works) or \`file\` (path to an existing .html file).
- \`title\`: a short name for the gallery.
- \`width\` x \`height\` is the browser viewport in CSS px (default 1280x800, or 800x450 for a sketch; 390x844 for a phone). Only that viewport is captured, so make it fit the content.
- To show several options, put them side by side in one page, or call the tool once per option.

The result gives the PNG path; Read it to check the render yourself.`

const LIVE_DESCRIPTION = `Open a live, clickable page in a pane beside the chat, in the user's terminal: a small browser with an address bar. The user clicks, types and scrolls in it. Also opens the gallery of everything shown so far.

Use it when the user wants to try a flow or an interaction, watch a page they are building, view a plain HTML artifact, or see earlier work. For a still picture use ${PREVIEW}.

- \`action\`: "open" (default), "look" (a PNG of what the pane shows now, plus its URL and title: Read the PNG to see it), "gallery" (opens the gallery pane) or "close".
- For "open", pass one of \`html\` (a whole page, saved to a file the result names: edit that file to update the preview), \`file\` (an .html file; the preview reloads when it changes) or \`url\` (e.g. a dev server at http://localhost:5173). claude.ai links do not open here: see the artifact steps in the instructions.
- \`device\`: "desktop" (default), "tablet" or "phone". \`title\`: a short name for the gallery. \`link\`: the claude.ai link, when \`file\` is an artifact's page.`

const PREVIEW_SCHEMA = {
  type: 'object',
  properties: {
    html: { type: 'string', description: 'The whole HTML page to render.' },
    file: { type: 'string', description: 'Path to an existing .html file, instead of html.' },
    title: { type: 'string', description: 'A short name for the gallery.' },
    size: { type: 'string', enum: ['sketch', 'full'], description: 'sketch: small inline picture. full: detailed mockup (default).' },
    width: { type: 'integer', minimum: 200, maximum: 3840, description: 'Viewport width in CSS px.' },
    height: { type: 'integer', minimum: 150, maximum: 4000, description: 'Viewport height in CSS px.' },
  },
}

const LIVE_SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['open', 'look', 'gallery', 'close'], description: 'Default open.' },
    html: { type: 'string', description: 'A whole HTML page to open.' },
    file: { type: 'string', description: 'Path to an .html file to open.' },
    url: { type: 'string', description: 'A URL to open, such as a local dev server.' },
    title: { type: 'string', description: 'A short name for the gallery.' },
    link: { type: 'string', description: 'The claude.ai link, when file is an artifact page.' },
    device: { type: 'string', enum: ['desktop', 'tablet', 'phone'], description: 'Default desktop.' },
  },
}

// ---- Shared state -------------------------------------------------------------

let cell: Cell = FALLBACK_CELL
let browser: string | undefined
let projectDir = ''
let lastBox = { columns: 1, rows: 1, top: 1, left: 0 }
let galleryView: GalleryView = { page: 0, isAll: false }

// What the live pane shows, kept in the session's state: it outlives a reload
// of this mod, which stops the browser, so the pane can come back by itself.
const lastLive = atom({ plugin: 'ccglimpse', key: 'last' } as const, null as GlimpseLive | null)

// The folder for pictures, pages, the gallery and the live browser.
async function workDir($: EngineInterface): Promise<string> {
  const home = await $.env.get('HOME')
  if (home === undefined) throw new Error('HOME is not set, so there is nowhere to keep pictures.')
  const dir = `${home}/.cache/ccglimpse`
  await $.process.run(['mkdir', '-p', '-m', '700', dir, `${dir}/pages`, `${dir}/live`, `${dir}/thumbs`])
  return dir
}

// Each session's live browser has a folder of its own, named after the
// session, so two sessions never share a browser, a profile or a socket.
const FALLBACK_NAME = `p${Date.now().toString(36)}`
async function liveFolder($: EngineInterface, dir: string): Promise<string> {
  const id = await $.session.id().catch(() => '')
  return `${dir}/live/${id.replace(/[^\w-]/g, '').slice(0, 40) || FALLBACK_NAME}`
}

async function needBrowser($: EngineInterface): Promise<string> {
  browser ??= await findBrowser($)
  if (browser === undefined) throw new Error('No Chromium or Chrome found. Install chromium.')
  return browser
}

// An absolute path for an existing file, or undefined.
async function realFile($: EngineInterface, path: string): Promise<string | undefined> {
  const stat = await $.fs.stat(path, { resolve: true }).catch(() => undefined)
  return stat?.realPath
}

// What the address bar was given -> a URL or an absolute file path.
async function resolveAddress($: EngineInterface, typed: string): Promise<string | undefined> {
  const text = typed.trim()
  if (text === '') return undefined
  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return text
  if (/^[~./]/.test(text)) {
    const home = (await $.env.get('HOME')) ?? ''
    return realFile($, text.replace(/^~(?=\/|$)/, home))
  }
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/.test(text)) return `http://${text}`
  return `https://${text}`
}

async function titleFor($: EngineInterface, target: string): Promise<string> {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return target.replace(/^https?:\/\//, '').replace(/\/$/, '')
  const html = await $.fs.read(target).catch(() => '')
  return titleOf(html, target.split('/').pop() ?? target)
}

type OpenOptions = { kind?: EntryKind; title?: string; link?: string }

// Opens the live pane on a file or URL, and keeps it in the gallery.
async function openTarget($: EngineInterface, target: string, device: Device, options: OpenOptions = {}): Promise<string> {
  const dir = await workDir($)
  const opened = await openLive($, { target, device, browser: await needBrowser($), dir: await liveFolder($, dir) })
  await update($, lastLive, () => ({ target, device }))
  const entry = await remember($, dir, {
    kind: options.kind ?? 'live',
    title: options.title ?? (await titleFor($, target)),
    isNamed: options.title !== undefined,
    page: target,
    device,
    link: options.link,
    cwd: projectDir,
  })
  setEntry(entry.id, `${dir}/thumbs`)
  $.ui.invalidate('ui.render')
  if (opened.isPlaced) return `Opened a live preview of ${target} (${device}) in a pane beside the chat.`
  return `The live preview of ${target} is running, but the pane is not shown yet (${opened.reason ?? 'the terminal is too narrow'}). The user can show it with /view or by widening the terminal.`
}

async function openInBrowser($: EngineInterface, target: string) {
  // setsid -f: the viewer runs on by itself, so this returns at once.
  await $.process.run(['setsid', '-f', 'xdg-open', target], { timeoutMs: 5000 }).catch(() => undefined)
}

async function openGallery($: EngineInterface) {
  await loadGallery($, await workDir($))
  galleryView = { ...galleryView, page: 0 }
  const opened = await $.ui.open({ id: GALLERY, title: 'Gallery' })
  $.ui.invalidate('ui.render')
  return opened
}

const deviceFor = (entry: Entry): Device =>
  entry.device ?? ((entry.width ?? 1280) <= 500 ? 'phone' : (entry.width ?? 1280) <= 900 && entry.kind === 'full' ? 'tablet' : 'desktop')

// After a reload: reopen the live pane that was showing.
async function resumeLive($: EngineInterface) {
  const last = await read($, lastLive)
  if (last === null || liveState() !== undefined) return
  await openTarget($, last.target, last.device).catch(() => undefined)
}

// ---- The hooks ------------------------------------------------------------------

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    projectDir = e.cwd
    await $.tool.register({ name: 'preview', description: PREVIEW_DESCRIPTION, inputSchema: PREVIEW_SCHEMA, isDeferred: false })
    await $.tool.register({ name: 'live', description: LIVE_DESCRIPTION, inputSchema: LIVE_SCHEMA, isDeferred: false })
    await $.command.register({
      name: 'view',
      description: 'The gallery of sketches and pages; or a live, clickable preview of a file or URL',
      argumentHint: '[<file|url> [desktop|tablet|phone] | close]',
    })

    const started = await next(e)
    // In the background: measure the terminal's cells, then bring back a live
    // pane that a reload of this mod closed.
    void measureCell($)
      .then(measured => {
        cell = measured
        setCell(measured)
      })
      .then(() => resumeLive($))
    return started
  })

  on('session.end', async ($, e, next) => {
    await stopLive($)
    return next(e)
  })

  // Tell Claude how to show UI (see ROUTING).
  on('prompt.compose', async ($, e, next) => {
    const { sections } = await next(e)
    return { sections: [...sections, { id: 'ccglimpse:routing', text: ROUTING, scope: 'session' as const }] }
  })

  // ---- Still pictures -----------------------------------------------------------

  on('tool.run', { tool: PREVIEW }, async ($, e) => {
    const size: Size = e.size === 'sketch' ? 'sketch' : 'full'
    const width = clampNumber(e.width, size === 'sketch' ? 800 : 1280, 200, 3840)
    const height = clampNumber(e.height, size === 'sketch' ? 450 : 800, 150, 4000)
    const dir = await workDir($)

    let page: string | undefined
    let html = ''
    if (typeof e.file === 'string' && e.file !== '') {
      page = await realFile($, e.file)
      if (page === undefined) return { deny: `Cannot find ${e.file}.` }
      html = await $.fs.read(page).catch(() => '')
    } else if (typeof e.html === 'string' && e.html.trim() !== '') {
      page = `${dir}/pages/${e.tool_use_id}.html`
      html = e.html
      await $.fs.write(page, html)
    } else {
      return { deny: 'Pass html (the page) or file (a path to an .html file).' }
    }

    const png = `${dir}/${e.tool_use_id}.png`
    // A sketch is drawn small, so 1x is sharp enough; a full picture gets 2x.
    const failure = await screenshot($, {
      browser: await needBrowser($),
      page,
      png,
      profile: `${dir}/browser-profile`,
      width,
      height,
      scale: size === 'sketch' ? 1 : 2,
    })
    if (failure !== undefined) return { deny: failure }

    const title = typeof e.title === 'string' && e.title.trim() !== '' ? e.title.trim() : titleOf(html, size === 'sketch' ? 'Sketch' : 'Mockup')
    await remember($, dir, { kind: size, title, isNamed: typeof e.title === 'string' && e.title.trim() !== '', page, png, width, height, cwd: projectDir })
    $.ui.invalidate('ui.render')
    return { result: `Rendered and shown to the user inline in the terminal (kept in the gallery as "${title}"). ${resultLine({ png, width, height, size, page })}` }
  }).catch(() => ({ deny: 'CCGlimpse: the preview failed. Run claude --debug for the reason.' }))

  // The picture, where the result text would be, with two buttons under it.
  on('ui.render', { component: 'ToolResult', props: { tool: PREVIEW } }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.isErrored) return next(e)
    const shot = readShot(e.props.output)
    if (shot === undefined) return next(e)

    const { Box, Button, Image } = $.ui.resolve(e)
    const box = fitToCells(shot, roomFor(shot.size, e.viewport), cell)
    const device: Device = shot.width <= 500 ? 'phone' : shot.width <= 900 && shot.size === 'full' ? 'tablet' : 'desktop'
    return (
      <Box flexDirection="column">
        {e.props.isExpanded === true ? await next(e) : null}
        <Image
          key="shot"
          source={{ file: shot.png, format: 'png' }}
          columns={box.columns}
          rows={box.rows}
          alt={`(this terminal cannot show pictures; open ${shot.png})`}
        />
        <Box flexDirection="row" gap={2}>
          <Button key="live" plain onPress={() => void openTarget($, shot.page, device).catch(error => $.ui.toast(String(error)))}>
            ▶ open live
          </Button>
          <Button key="browser" plain onPress={() => void openInBrowser($, shot.page)}>
            ↗ browser
          </Button>
          <Button key="gallery" plain onPress={() => void openGallery($)}>
            ▦ gallery
          </Button>
        </Box>
      </Box>
    )
  })

  // Keep the call's row short: without this it prints the whole HTML.
  on('ui.render', { component: 'ToolUse', props: { tool: PREVIEW } }, ($, e, next) => {
    if (e.props.isExpanded === true) return next(e)
    const input = (e.props.input ?? {}) as Record<string, unknown>
    const size = input.size === 'sketch' ? 'sketch' : 'full'
    const what =
      typeof input.title === 'string' ? input.title : typeof input.file === 'string' ? input.file : `HTML, ${Math.max(1, Math.round(String(input.html ?? '').length / 1024))} KB`
    return next({ ...e, props: { ...e.props, input: { [size]: what } } })
  })

  // ---- The live pane ------------------------------------------------------------

  on('tool.run', { tool: LIVE }, async ($, e) => {
    const action = e.action === 'look' || e.action === 'close' || e.action === 'gallery' ? e.action : 'open'

    if (action === 'close') {
      await $.ui.close({ id: PANE })
      await stopLive($)
      return { result: 'Closed the live preview.' }
    }

    if (action === 'gallery') {
      const opened = await openGallery($)
      const count = (await loadGallery($, await workDir($))).length
      return {
        result: opened.isPlaced
          ? `Opened the gallery pane (${count} entries). The user picks one there and can open it live.`
          : `The gallery is ready but its pane is not shown (${opened.reason}). The user can run /view.`,
      }
    }

    if (action === 'look') {
      const current = liveState()
      if (current?.frame === undefined) return { deny: 'No live preview is open.' }
      const sizes =
        `Picture box ${lastBox.columns}x${lastBox.rows} cells; ` +
        `cell ${cell.width.toFixed(1)}x${cell.height.toFixed(1)} px (${cell.isMeasured ? 'measured' : 'estimated'}).`
      return {
        result: `The live preview shows ${current.title || '(no title)'} at ${current.url} (${current.device}). PNG of the pane now: ${current.frame}. ${sizes}`,
      }
    }

    const device: Device = isDevice(e.device) ? e.device : 'desktop'
    const title = typeof e.title === 'string' && e.title.trim() !== '' ? e.title.trim() : undefined
    const link = typeof e.link === 'string' && ARTIFACT_LINK.test(e.link) ? e.link : undefined
    let target: string
    let note = ''
    if (typeof e.url === 'string' && e.url !== '') {
      if (CLAUDE_AI.test(e.url)) {
        return {
          deny:
            'claude.ai pages do not open in this headless browser (claude.ai turns it away). For an artifact: read it with the Artifact tool ' +
            '(action "read", path "index.html", plus `paths` for its other files), then call this tool with the saved index.html as `file` and the link as `link`. ' +
            'Artifacts made from an Artifact type (Docs, Slides, Dashboard, Design...) only run on claude.ai: give the user the link instead.',
        }
      }
      if (!/^(https?|file):/i.test(e.url)) return { deny: 'url must start with http://, https:// or file://.' }
      target = e.url
    } else if (typeof e.file === 'string' && e.file !== '') {
      const real = await realFile($, e.file)
      if (real === undefined) return { deny: `Cannot find ${e.file}.` }
      target = real
      note = ` It reloads when ${real} changes.`
    } else if (typeof e.html === 'string' && e.html.trim() !== '') {
      const dir = await workDir($)
      target = `${dir}/pages/live-${e.tool_use_id}.html`
      await $.fs.write(target, e.html)
      note = ` The page is saved at ${target}; edit that file to update the preview (it reloads on change).`
    } else {
      return { deny: 'Pass url, file or html.' }
    }
    const said = await openTarget($, target, device, { kind: link === undefined ? 'live' : 'artifact', title, link })
    return { result: `${said}${note} The user can click, type and scroll in it. It is kept in the gallery.` }
  }).catch(() => ({ deny: 'CCGlimpse: the live preview failed. Run claude --debug for the reason.' }))

  on('ui.render', { component: 'ToolUse', props: { tool: LIVE } }, ($, e, next) => {
    if (e.props.isExpanded === true) return next(e)
    const input = (e.props.input ?? {}) as Record<string, unknown>
    const what =
      typeof input.title === 'string'
        ? input.title
        : typeof input.url === 'string'
          ? input.url
          : typeof input.file === 'string'
            ? input.file
            : input.html
              ? 'HTML page'
              : ''
    const action = typeof input.action === 'string' ? input.action : 'open'
    return next({ ...e, props: { ...e.props, input: what ? { [action]: what } : { action } } })
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (e.surface !== 'terminal') {
      const { Text } = $.ui.resolve(e)
      return <Text dimColor>The live preview is drawn in the terminal.</Text>
    }
    const { Box, Button, Client, Image, Input, Text } = $.ui.resolve(e)
    const current = liveState()
    if (current === undefined) {
      return <Text dimColor>No live preview. Run /view with a file or URL, or /view alone for the gallery.</Text>
    }

    const box = paneBox(e.props.bodyColumns, e.props.scroll.bodyRows)
    lastBox = { columns: box.columns, rows: box.rows, top: box.top, left: box.left }
    fitBrowser($, box.view)

    const go = async (typed: string) => {
      const target = await resolveAddress($, typed)
      if (target === undefined) return $.ui.toast(`Cannot open ${typed}`)
      try {
        await navigateLive($, target)
        const dir = await workDir($)
        const entry = await remember($, dir, { kind: 'live', title: await titleFor($, target), page: target, device: current.device, cwd: projectDir })
        setEntry(entry.id, `${dir}/thumbs`)
        await update($, lastLive, () => ({ target, device: current.device }))
      } catch (error) {
        $.ui.toast(String(error))
      }
    }
    const deviceButton = (device: Device) => (
      <Button key={`device-${device}`} plain variant={current.device === device ? 'primary' : 'secondary'} onPress={() => void setDevice($, device)}>
        {current.device === device ? `[${device}]` : device}
      </Button>
    )
    const address = current.url.replace(/^file:\/\//, '')
    const isBlocked = CLAUDE_AI.test(current.url)
    const status =
      current.error ??
      current.notice ??
      (isBlocked
        ? 'claude.ai turns this headless browser away. Ask Claude to show a plain HTML artifact here instead.'
        : `${current.title || 'page'} · click to use, Esc gives keys back`)

    return (
      <Box flexDirection="column" width={e.props.bodyColumns}>
        <Box flexDirection="row" gap={1} height={1}>
          <Button key="back" plain onPress={() => void historyLive($, 'back').catch(() => undefined)}>
            ←
          </Button>
          <Button key="forward" plain onPress={() => void historyLive($, 'forward').catch(() => undefined)}>
            →
          </Button>
          <Button key="reload" plain onPress={() => void reloadLive($).catch(() => undefined)}>
            ↻
          </Button>
          <Box flexGrow={1}>
            <Input key="address" value={address} placeholder="file path or URL, Enter to open" onSubmit={value => void go(value)} />
          </Box>
        </Box>
        <Box flexDirection="row" gap={2} height={1} overflow="hidden">
          {deviceButton('desktop')}
          {deviceButton('tablet')}
          {deviceButton('phone')}
          <Button key="browser" plain onPress={() => void openInBrowser($, current.url || current.target)}>
            ↗ browser
          </Button>
          <Button key="gallery" plain onPress={() => void openGallery($)}>
            ▦ gallery
          </Button>
        </Box>
        <Box height={box.rows} paddingLeft={box.left}>
          {current.frame === undefined ? (
            <Text dimColor>{current.error ?? 'Starting the browser…'}</Text>
          ) : (
            <Box position="relative" width={box.columns} height={box.rows}>
              <Image key="view" source={{ file: current.frame, format: 'png' }} columns={box.columns} rows={box.rows} alt="(live preview: this terminal cannot show pictures)" />
              <Box position="absolute" top={0} left={0} width={box.columns} height={box.rows}>
                <Client key="pointer" module="./pointer.tsx" width={box.columns} height={box.rows} props={{ ack: current.ack }} />
              </Box>
            </Box>
          )}
        </Box>
        <Text dimColor wrap="truncate-end">
          {status}
        </Text>
      </Box>
    )
  })

  // Clicks and keys from the click layer.
  on('ui.message', { element: 'pointer' }, ($, e) => ({ props: forward($, e.data) }))

  // The wheel over the pane scrolls the page, not the pane.
  on('ui.scroll', { component: 'Pane', requestId: PANE }, ($, e) => {
    wheel($, e.by, e.pointer, lastBox)
    return {}
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    await stopLive($)
    // Closed by the person or by us: forget it. Closed by a reload: keep it,
    // so the pane comes back once the new version has loaded.
    if (e.origin.kind !== 'unload') await update($, lastLive, () => null)
    return next(e)
  })

  // ---- The gallery pane -----------------------------------------------------------

  on('ui.render', { component: 'Pane', requestId: GALLERY }, async ($, e) => {
    if (e.surface !== 'terminal') {
      const { Text } = $.ui.resolve(e)
      return <Text dimColor>The gallery is drawn in the terminal.</Text>
    }
    const { Box, Button, Image, Text } = $.ui.resolve(e)
    const dir = await workDir($)
    const entries = await loadGallery($, dir)
    const redraw = (change: Partial<GalleryView>) => {
      galleryView = { ...galleryView, ...change }
      $.ui.invalidate('ui.render')
    }
    return drawGallery(
      { Box, Button, Image, Text },
      { columns: e.props.bodyColumns, rows: e.props.scroll.bodyRows },
      entries,
      projectDir,
      galleryView,
      cell,
      {
        pick: id => redraw({ picked: id }),
        turn: page => redraw({ page }),
        showAll: isAll => redraw({ isAll, page: 0 }),
        openLive: entry =>
          void openTarget($, entry.page, deviceFor(entry), { kind: entry.kind === 'artifact' ? 'artifact' : 'live', title: entry.isNamed === true ? entry.title : undefined, link: entry.link }).catch(
            error => $.ui.toast(String(error)),
          ),
        openBrowser: entry => void openInBrowser($, entry.link ?? entry.page),
        remove: entry =>
          void forget($, dir, entry.id).then(() => redraw({ picked: undefined })),
      },
    )
  })

  // ---- Artifacts: a "view here" button under a published HTML artifact ------------

  on('ui.render', { component: 'ToolUse', props: { tool: 'Artifact' } }, async ($, e, next) => {
    const row = await next(e)
    if (e.surface !== 'terminal' || e.props.isRunning || e.props.isErrored || e.props.isInterrupted) return row
    const input = (e.props.input ?? {}) as Record<string, unknown>
    const isPublish = input.action === undefined || input.action === 'publish'
    const file = typeof input.file_path === 'string' && /\.html?$/i.test(input.file_path) ? input.file_path : undefined
    if (!isPublish || file === undefined || input.asset === true) return row
    const link = ARTIFACT_LINK.exec(JSON.stringify(e.props.output ?? ''))?.[0]
    const { Box, Button } = $.ui.resolve(e)
    const view = async () => {
      const real = await realFile($, file)
      if (real === undefined) return $.ui.toast(`Cannot find ${file}`)
      await openTarget($, real, 'desktop', { kind: 'artifact', link })
    }
    return (
      <Box flexDirection="column">
        {row}
        <Button key="view-here" plain onPress={() => void view().catch(error => $.ui.toast(String(error)))}>
          ▶ view here (live, in the terminal)
        </Button>
      </Box>
    )
  })

  // ---- /view ----------------------------------------------------------------------

  on('command.run', { command: 'view' }, async ($, e) => {
    const words = e.args.trim().split(/\s+/).filter(Boolean)
    const [first, second] = words
    if (first === undefined || first === 'gallery') {
      const opened = await openGallery($)
      return { text: opened.isPlaced ? 'Opened the gallery.' : `The gallery could not be shown: ${opened.reason}` }
    }
    if (first === 'close') {
      await $.ui.close({ id: PANE })
      await stopLive($)
      return { text: 'Closed the live preview.' }
    }
    const device: Device = isDevice(second) ? second : 'desktop'
    const target = await resolveAddress($, first)
    if (target === undefined) return { text: `Cannot find ${first}.` }
    try {
      return { text: await openTarget($, target, device) }
    } catch (error) {
      return { text: `The live preview failed: ${error instanceof Error ? error.message : String(error)}` }
    }
  })
}
