import { expect, test } from 'claude-code/testing'

import { mayRename, mergeEntry, titleOf } from './gallery'

const output = (size: 'sketch' | 'full') =>
  'Rendered and shown to the user inline in the terminal. ' +
  `PNG: /home/me/.cache/claude-wireframe/toolu_1.png (800x450, ${size}) from /home/me/.cache/claude-wireframe/pages/toolu_1.html`

const result = (size: 'sketch' | 'full') =>
  ({
    plugin: 'wireframe',
    component: 'ToolResult',
    requestId: 'toolu_1',
    props: { tool_use_id: 'toolu_1', tool: 'mcp__wireframe__preview', output: output(size), isErrored: false },
  }) as const


test('a sketch is drawn as a small picture with its two buttons', async ($, on) => {
  // Stands for the engine's own drawing of the result text.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine text</Text>
  })
  const ui = await $.ui.mount({ ...result('sketch'), surface: 'terminal', viewport: { columns: 200, rows: 60 } })
  const picture = await ui.find({ type: 'Image', key: 'shot' })
  expect(picture).toBeDefined()
  // A sketch stays about the size of an ASCII sketch.
  expect(Number(picture?.props.columns)).toBeLessThanOrEqual(64)
  expect(Number(picture?.props.rows)).toBeLessThanOrEqual(16)
  expect(await ui.find({ type: 'Button', key: 'live' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'browser' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'gallery' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /engine text/ })).toBeUndefined()
  await ui.unmount()
})

test('a full picture takes the width of the chat', async ($, on) => {
  // Stands for the engine's own drawing of the result text.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine text</Text>
  })
  const ui = await $.ui.mount({ ...result('full'), surface: 'terminal', viewport: { columns: 200, rows: 60 } })
  const picture = await ui.find({ type: 'Image', key: 'shot' })
  expect(Number(picture?.props.columns)).toBeGreaterThan(64)
  await ui.unmount()
})

test('other surfaces keep the engine text', async ($, on) => {
  // Stands for the engine's own drawing of the result text.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine text</Text>
  })
  const ui = await $.ui.mount({ ...result('full'), surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /engine text/ }))?.text).toBe('engine text')
  await ui.unmount()
})

test('the live pane says how to start when nothing is open', async ($) => {
  const ui = await $.ui.mount({
    plugin: 'wireframe',
    component: 'Pane',
    requestId: 'wireframe-live',
    surface: 'terminal',
    props: { title: 'Live preview', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
  })
  expect((await ui.find({ type: 'Text', text: /No live preview/ }))?.text).toContain('/view')
  await ui.unmount()
})

test('the gallery pane lists entries and shows the picked one', async ($, on) => {
  const entries = [
    { id: 'a', kind: 'live', title: 'Settings flow', page: '/p/a.html', png: '/p/a.png', width: 390, height: 844, device: 'phone', cwd: '/proj', at: Date.now() },
    { id: 'b', kind: 'sketch', title: 'Sidebar vs tabs', page: '/p/b.html', cwd: '/elsewhere', at: Date.now() },
  ]
  // Stand for the engine: HOME, mkdir and the gallery file.
  on('env.get', () => ({ value: '/home/me' }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('fs.read', () => ({ value: JSON.stringify(entries) }))
  const ui = await $.ui.mount({
    plugin: 'wireframe',
    component: 'Pane',
    requestId: 'wireframe-gallery',
    surface: 'terminal',
    props: { title: 'Gallery', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  })
  expect(await ui.find({ type: 'Button', key: 'scope-all' })).toBeDefined()
  // "all" shows both; the first is picked, so its picture and actions show.
  await ui.press({ key: 'scope-all' })
  expect(await ui.find({ type: 'Button', key: 'item-a' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'item-b' })).toBeDefined()
  expect(await ui.find({ type: 'Image', key: 'pick' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'open-live' })).toBeDefined()
  // Picking the sketch, which has no picture yet.
  await ui.press({ key: 'item-b' })
  expect(await ui.find({ type: 'Image', key: 'pick' })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /No picture yet/ }))?.text).toContain('open it live')
  await ui.unmount()
})

const artifactRow = (input: Record<string, unknown>) =>
  ({
    plugin: 'wireframe',
    component: 'ToolUse',
    requestId: 'toolu_2',
    surface: 'terminal',
    props: {
      tool_use_id: 'toolu_2',
      tool: 'Artifact',
      input,
      output: 'Published https://claude.ai/artifact/AbC123 (version 1)',
      isRunning: false,
      isErrored: false,
      isInterrupted: false,
    },
  }) as const

test('a published HTML artifact gets a "view here" button', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine row</Text>
  })
  const ui = await $.ui.mount(artifactRow({ file_path: '/tmp/page.html' }))
  expect(await ui.find({ type: 'Button', key: 'view-here' })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /engine row/ }))?.text).toBe('engine row')
  await ui.unmount()
})

test('other Artifact calls keep their row as it is', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine row</Text>
  })
  const ui = await $.ui.mount(artifactRow({ action: 'read', url: 'https://claude.ai/artifact/AbC123' }))
  expect(await ui.find({ type: 'Button', key: 'view-here' })).toBeUndefined()
  await ui.unmount()
})

test('a page is named by its title, else its first heading', async () => {
  expect(titleOf('<title> Settings  flow </title><h1>x</h1>', 'f')).toBe('Settings flow')
  expect(titleOf('<body><h1>Plan <b>B</b></h1>', 'f')).toBe('Plan B')
  expect(titleOf('<p>nothing</p>', 'fallback')).toBe('fallback')
})

test('a name given to an entry is kept; the page title names the rest', async () => {
  const named = mergeEntry(undefined, { kind: 'artifact', title: 'Roast Log (artifact)', isNamed: true, page: '/p/roast.html', cwd: '/x' }, 1)
  expect(mayRename(named, 'Roast Log')).toBe(false)
  // Opened again from the "view here" button, which gives no name.
  const again = mergeEntry(named, { kind: 'artifact', title: 'Roast Log', page: '/p/roast.html', cwd: '/x' }, 2)
  expect(again.title).toBe('Roast Log (artifact)')
  expect(again.id).toBe(named.id)
  const plain = mergeEntry(undefined, { kind: 'live', title: 'tasks.html', page: '/p/tasks.html', png: '/t.png', cwd: '/x' }, 3)
  expect(mayRename(plain, 'Tasks flow')).toBe(true)
  // Reopened without a new picture: the old one stays.
  expect(mergeEntry(plain, { kind: 'live', title: 'tasks.html', page: '/p/tasks.html', cwd: '/x' }, 4).png).toBe('/t.png')
})
