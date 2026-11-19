// The gallery pane: a list of everything shown, the picture of the one
// picked, and what to do with it.
//
//   Gallery · 12 here · [this project] all
//   ▸ Settings flow                         live · phone · 2m
//     Sidebar vs tabs                       sketch · 5m
//     ↑ newer  ↓ older  3/5
//   ▶ open live   ↗ browser   ✕ remove
//   <the picked entry's picture>

import type { Elements } from 'claude-code'

import type { Cell } from './cells'
import { timeAgo, type Entry } from './gallery'
import { fitToCells } from './preview'

export const GALLERY = 'wireframe-gallery'

export type GalleryView = { picked?: string; page: number; isAll: boolean }

export type GalleryActions = {
  pick: (id: string) => void
  turn: (page: number) => void
  showAll: (isAll: boolean) => void
  openLive: (entry: Entry) => void
  openBrowser: (entry: Entry) => void
  remove: (entry: Entry) => void
}

const KIND_LABEL: Record<Entry['kind'], string> = { sketch: 'sketch', full: 'mockup', live: 'live', artifact: 'artifact' }

const cut = (text: string, width: number) => (text.length <= width ? text.padEnd(width) : `${text.slice(0, Math.max(1, width - 1))}…`)

// `elements` is the terminal's table from $.ui.resolve(e).
export function drawGallery(
  elements: Pick<Elements['terminal'], 'Box' | 'Text' | 'Button' | 'Image'>,
  room: { columns: number; rows: number },
  all: Entry[],
  projectDir: string,
  view: GalleryView,
  cell: Cell,
  act: GalleryActions,
) {
  const { Box, Text, Button, Image } = elements
  const shown = view.isAll ? all : all.filter(entry => entry.cwd === projectDir)

  const header = (
    <Box flexDirection="row" gap={2} height={1}>
      <Text bold>Gallery</Text>
      <Text dimColor>{shown.length} {view.isAll ? 'in all' : 'in this project'}</Text>
      <Button key="scope-project" plain variant={view.isAll ? 'secondary' : 'primary'} onPress={() => act.showAll(false)}>
        {view.isAll ? 'this project' : '[this project]'}
      </Button>
      <Button key="scope-all" plain variant={view.isAll ? 'primary' : 'secondary'} onPress={() => act.showAll(true)}>
        {view.isAll ? '[all]' : 'all'}
      </Button>
    </Box>
  )

  if (shown.length === 0) {
    return (
      <Box flexDirection="column" width={room.columns}>
        {header}
        <Text dimColor>
          Nothing here yet. Sketches, mockups, live pages and artifacts you view here are kept, newest first.
        </Text>
      </Box>
    )
  }

  // The list takes about a third of the room; the picture the rest.
  const listRows = Math.max(3, Math.min(shown.length, Math.floor((room.rows - 4) / 3)))
  const pages = Math.max(1, Math.ceil(shown.length / listRows))
  const page = Math.min(view.page, pages - 1)
  const visible = shown.slice(page * listRows, page * listRows + listRows)
  const picked = shown.find(entry => entry.id === view.picked) ?? visible[0]

  const metaWidth = 24
  const titleWidth = Math.max(10, room.columns - metaWidth - 4)
  const rows = visible.map(entry => {
    const isPicked = entry.id === picked?.id
    const meta = [KIND_LABEL[entry.kind], entry.device && entry.kind !== 'sketch' ? entry.device : '', timeAgo(entry.at)].filter(Boolean).join(' · ')
    return (
      <Button key={`item-${entry.id}`} plain variant={isPicked ? 'primary' : 'secondary'} onPress={() => act.pick(entry.id)}>
        {isPicked ? '▸ ' : '  '}
        {cut(entry.title, titleWidth)} <Text dimColor>{meta}</Text>
      </Button>
    )
  })

  const pager =
    pages > 1 ? (
      <Box flexDirection="row" gap={2} height={1}>
        <Button key="newer" plain onPress={() => act.turn(Math.max(0, page - 1))}>
          ↑ newer
        </Button>
        <Button key="older" plain onPress={() => act.turn(Math.min(pages - 1, page + 1))}>
          ↓ older
        </Button>
        <Text dimColor>
          {page + 1}/{pages}
        </Text>
      </Box>
    ) : null

  const actions =
    picked === undefined ? null : (
      <Box flexDirection="row" gap={3} height={1}>
        <Button key="open-live" plain variant="primary" onPress={() => act.openLive(picked)}>
          ▶ open live
        </Button>
        <Button key="open-browser" plain onPress={() => act.openBrowser(picked)}>
          ↗ browser
        </Button>
        <Button key="remove" plain onPress={() => act.remove(picked)}>
          ✕ remove
        </Button>
        {picked.link !== undefined ? <Text dimColor>{picked.link}</Text> : null}
      </Box>
    )

  const usedRows = 1 + visible.length + (pager === null ? 0 : 1) + 1 + 1
  const pictureRoom = { columns: room.columns, rows: Math.max(3, room.rows - usedRows) }
  let picture
  if (picked?.png !== undefined && picked.width !== undefined && picked.height !== undefined) {
    const box = fitToCells({ width: picked.width, height: picked.height }, pictureRoom, cell)
    picture = (
      <Image key="pick" source={{ file: picked.png, format: 'png' }} columns={box.columns} rows={box.rows} alt={`(picture: ${picked.png})`} />
    )
  } else {
    picture = <Text dimColor>No picture yet: open it live once to take one.</Text>
  }

  return (
    <Box flexDirection="column" width={room.columns}>
      {header}
      {rows}
      {pager}
      {actions}
      <Box height={1} />
      {picture}
    </Box>
  )
}

