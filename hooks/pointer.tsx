// The click layer of the live preview: an empty region laid exactly over the
// picture. It draws nothing, so the picture shows through, and it hears every
// click, drag and key over it. It posts them to the hooks module, which sends
// them on to the browser.
//
// Positions are posted as fractions of the region (0 to 1), so the hooks
// module can turn them into page pixels whatever the page's size.

import type { ClientModule } from 'claude-code'

type Props = { ack?: number }

type InputEvent = {
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

// Kept across redraws. The queue holds every event the hooks module has not
// acknowledged yet: a post can be replaced by a later one in the same frame,
// so each post carries the whole queue.
type Inbox = { queue: InputEvent[]; lastId: number; lastMoveAt: number; isDown: boolean }
type State = { inbox: Inbox }

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

const Pointer: ClientModule<Props, State> = (props, surface) => {
  const { Box } = surface.elements
  let state = surface.state

  // Step 1, once: start listening.
  if (state === undefined) {
    const inbox: Inbox = { queue: [], lastId: 0, lastMoveAt: 0, isDown: false }
    state = { inbox }

    const send = (event: Omit<InputEvent, 'id'>) => {
      inbox.lastId += 1
      inbox.queue.push({ ...event, id: inbox.lastId })
      surface.post({ events: inbox.queue })
    }

    surface.onPointer(e => {
      const fx = clamp01((e.fine?.x ?? e.x + 0.5) / Math.max(1, surface.columns))
      const fy = clamp01((e.fine?.y ?? e.y + 0.5) / Math.max(1, surface.rows))
      if (e.type === 'down') {
        inbox.isDown = true
        send({ type: 'down', fx, fy, button: e.button ?? 'left' })
      } else if (e.type === 'up') {
        inbox.isDown = false
        send({ type: 'up', fx, fy, button: e.button ?? 'left' })
      } else if (e.type === 'move') {
        // Hover and drags: at most one move per 50 ms keeps the browser calm.
        const now = Date.now()
        if (now - inbox.lastMoveAt < 50) return
        inbox.lastMoveAt = now
        send({ type: 'move', fx, fy })
      }
    })

    // Keys arrive once a click has given the region the focus; Esc gives it back.
    surface.onKey(k => send({ type: 'key', fx: 0, fy: 0, key: k.key, ctrl: k.ctrl, shift: k.shift, meta: k.meta }))

    surface.setState(state)
  }

  // Step 2, on every draw: forget what the hooks module has acknowledged.
  const ack = props?.ack ?? 0
  state.inbox.queue = state.inbox.queue.filter(event => event.id > ack)

  return <Box width={surface.columns} height={surface.rows} />
}

export default Pointer
