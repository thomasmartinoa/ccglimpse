// The wireframe mod's type contract.

// The page the live pane shows: kept in the session's state so the pane can
// come back after the mod reloads (an update, or an edit while developing).
export type WireframeLive = { target: string; device: 'desktop' | 'tablet' | 'phone' }

declare module 'claude-code' {
  interface PluginState {
    wireframe: { last: WireframeLive | null }
  }

  // The inputs of the two tools this mod registers, so `e` is typed in their
  // tool.run hooks. They match PREVIEW_SCHEMA and LIVE_SCHEMA in register.tsx.
  interface McpToolInputs {
    mcp__wireframe__preview: {
      html?: string
      file?: string
      title?: string
      size?: 'sketch' | 'full'
      width?: number
      height?: number
    }
    mcp__wireframe__live: {
      action?: 'open' | 'look' | 'gallery' | 'close'
      html?: string
      file?: string
      url?: string
      title?: string
      link?: string
      device?: 'desktop' | 'tablet' | 'phone'
    }
  }
}
