// The gallery: everything shown with this plugin, kept across sessions in
// ~/.cache/claude-wireframe/gallery.json, newest first.

import type { EngineInterface } from 'claude-code'

export type EntryKind = 'sketch' | 'full' | 'live' | 'artifact'

export type Entry = {
  id: string
  kind: EntryKind
  title: string
  // Named by Claude or the person: the page's own title does not replace it.
  isNamed?: boolean
  // What to open again: an .html file path, or a URL.
  page: string
  // A picture of it (a still, or the live page's last frame), when there is one.
  png?: string
  width?: number
  height?: number
  device?: 'desktop' | 'tablet' | 'phone'
  // The claude.ai link of an artifact.
  link?: string
  // The project folder it was made in.
  cwd: string
  at: number
}

const MAX_ENTRIES = 300

let entries: Entry[] | undefined
let file = ''

export async function loadGallery($: EngineInterface, dir: string): Promise<Entry[]> {
  file = `${dir}/gallery.json`
  if (entries !== undefined) return entries
  try {
    const parsed: unknown = JSON.parse(await $.fs.read(file))
    entries = Array.isArray(parsed) ? (parsed as Entry[]) : []
  } catch {
    entries = []
  }
  return entries
}

async function save($: EngineInterface) {
  if (file === '' || entries === undefined) return
  await $.fs.write(file, JSON.stringify(entries, null, 1))
}

export type NewEntry = Omit<Entry, 'id' | 'at'> & { id?: string }

// The entry an open makes, from the one already kept for the same page (if
// any): it keeps its id, its picture until a new one comes, and a name it
// was given.
export function mergeEntry(same: Entry | undefined, entry: NewEntry, at: number): Entry {
  const id = same?.id ?? entry.id ?? `e${at.toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const merged: Entry = { ...same, ...entry, id, at }
  if (same !== undefined && entry.png === undefined) merged.png = same.png
  if (same?.isNamed === true && entry.isNamed !== true) {
    merged.title = same.title
    merged.isNamed = true
  }
  return merged
}

// Whether the page's own title may rename an entry.
export const mayRename = (entry: Entry, title: string) => entry.isNamed !== true && title.trim() !== '' && entry.title !== title.trim()

// Adds an entry, or refreshes the one that already shows the same page.
export async function remember($: EngineInterface, dir: string, entry: NewEntry) {
  const list = await loadGallery($, dir)
  const merged = mergeEntry(list.find(one => one.page === entry.page), entry, Date.now())
  entries = [merged, ...list.filter(one => one.id !== merged.id)].slice(0, MAX_ENTRIES)
  await save($)
  return merged
}

export async function updateEntry($: EngineInterface, id: string, change: Partial<Entry>) {
  if (entries === undefined) return
  const one = entries.find(entry => entry.id === id)
  if (one === undefined) return
  Object.assign(one, change)
  await save($)
}

// The page's own title names an entry nobody named.
export async function nameFromPage($: EngineInterface, id: string, title: string) {
  const one = entries?.find(entry => entry.id === id)
  if (one === undefined || !mayRename(one, title)) return
  await updateEntry($, id, { title: title.trim() })
}

// Forgets an entry, and deletes its files when they are the plugin's own.
export async function forget($: EngineInterface, dir: string, id: string) {
  const list = await loadGallery($, dir)
  const one = list.find(entry => entry.id === id)
  entries = list.filter(entry => entry.id !== id)
  await save($)
  const ours = [one?.png, one?.page].filter((path): path is string => typeof path === 'string' && path.startsWith(`${dir}/`))
  if (ours.length > 0) await $.process.run(['rm', '-f', '--', ...ours]).catch(() => undefined)
}

// A short name for a page: its <title>, else its first heading, else a fallback.
export function titleOf(html: string, fallback: string): string {
  const pick = (pattern: RegExp) =>
    pattern
      .exec(html)?.[1]
      ?.replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  return pick(/<title[^>]*>([\s\S]*?)<\/title>/i) || pick(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || pick(/<h2[^>]*>([\s\S]*?)<\/h2>/i) || fallback
}

export function timeAgo(at: number): string {
  const seconds = Math.max(0, (Date.now() - at) / 1000)
  if (seconds < 60) return 'now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`
  return `${Math.floor(seconds / 86400)}d`
}
