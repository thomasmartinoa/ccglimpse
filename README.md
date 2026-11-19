# CCGlimpse

Claude Code Glimpse: a Claude Code plugin that shows UI right in the terminal instead of ASCII sketches or a browser.

- **Sketches and mockups as real pictures.** Claude writes HTML, a headless Chromium renders it, and the picture appears in the chat. `sketch` is small, about the room an ASCII sketch takes. `full` is as wide as the chat.
- **Live, clickable pages in a pane.** A page opens in a pane beside the chat, and you click, type and scroll in it like in a browser. It reloads when its file changes, so you watch Claude's edits land. It also works with a dev server such as `http://localhost:5173`.
- **A gallery of everything shown.** Every sketch, mockup, live page and artifact you view is kept across sessions, newest first, with a picture of each. Pick one to see it again, open it live, open it in your browser, or remove it.
- **Artifacts in the terminal.** When Claude publishes an artifact from an HTML file, its row gets a **view here** button that opens the file live in the pane. For an artifact link, Claude can read the artifact's page and open it here too. This works for plain HTML artifacts. Artifacts made from a type (Docs, Slides, Dashboard, Design) only run on claude.ai, so for those you get the link.
- **Terminal or artifact.** Claude shows small and medium visuals here without asking. If you mention an artifact, or the work is large (a multi-page site, a design system, something to share), it asks you which you want.

## Requirements

- kitty or Ghostty. Pictures use the kitty graphics protocol with Unicode placeholders.
- Claude Code 2.1.326 or later, in fullscreen mode (`"tui": "fullscreen"`) for clicks and the docked pane.
- Chromium or Chrome.
- Node 22 or later, for the live pane.
- Optional: python3, to measure the terminal's cell size. It falls back to 14x31 px.

## Install

At a Claude Code prompt:

```
/plugin marketplace add thomasmartinoa/ccglimpse
/plugin install ccglimpse@ccglimpse
```

From a local copy instead: `/plugin marketplace add /path/to/ccglimpse`.

## Use

Ask in your own words, for example "sketch two layouts for the settings page", "show me the phone version", or "let me click through the signup flow". You can also open the live pane yourself:

```
/view path/to/page.html [desktop|tablet|phone]
/view http://localhost:5173 phone
/view close
/view                 (the gallery)
```

In the live pane:

- Click into the page to use it. Keys then go to the page; Esc gives them back to the prompt.
- The mouse wheel scrolls the page.
- The top row is the address bar: ← back, → forward, ↻ reload, and a box where you type a file path or URL and press Enter.
- The second row is: desktop / tablet / phone, open in your browser, and the gallery.
- Links that would open a new tab open in the same pane. A page's `alert()` or `confirm()` is answered for it, and the message shows in the status line.
- claude.ai pages do not load here: claude.ai turns away a headless browser.

Under each still picture there are three buttons: **open live** (the same page, clickable, in the pane), **browser**, and **gallery**.

In the gallery: the list is at the top (`this project` or `all`), with ↑ newer / ↓ older to page through it. The picked entry's picture is underneath, with **open live**, **browser** and **remove**. A live page's picture is its last frame, taken while it was open.

## How it works

| File | What it does |
|---|---|
| `hooks/register.tsx` | Entry point: the two tools (`preview`, `live`), `/view`, the terminal-or-artifact rules Claude reads, and the drawing hooks |
| `hooks/preview.ts` | Still pictures: `chromium --headless --screenshot`, and fitting the PNG to a box of cells |
| `hooks/live.tsx` | The live pane: starts the helper, swaps new frames into the picture, sends clicks and keys on |
| `hooks/gallery.ts` | The gallery list, kept in `~/.cache/ccglimpse/gallery.json` |
| `hooks/gallery-pane.tsx` | Draws the gallery pane |
| `hooks/pointer.tsx` | An invisible region over the picture that catches clicks and keys |
| `hooks/cells.ts` | Measures a terminal cell in pixels, so pictures keep their shape |
| `runtime/live-helper.mjs` | A small Node program that drives a hidden Chromium over the DevTools protocol, writes each new frame as a PNG, and takes input on a Unix socket |

Everything stays on your machine. Pictures, pages, the gallery and the browser's throwaway profile live in `~/.cache/ccglimpse/`. Each session's live browser has its own folder under `live/`, so several sessions can run at once; folders of sessions that ended are cleared the next time a live pane opens. The browser never uses your own profile or logins. The plugin itself sends nothing over the network; a page you open loads whatever that page loads.

## Develop

```
claude plugin validate .
claude plugin test .
```

Edits to a local copy load with `/reload-plugins`.
