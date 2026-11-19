# CCGlimpse

**Claude Code Glimpse**: see UI right in your terminal while you work with Claude Code.

When Claude would draw a layout with ASCII boxes, it now shows you a real picture instead, right in the chat. When you want to try a page, it opens a live, clickable copy in a pane beside the chat. Everything you see is kept in a gallery you can come back to.

- **Sketches and mockups as real pictures.** Claude writes HTML, a hidden Chromium renders it, and the picture appears in the chat. A `sketch` is small, about the room an ASCII drawing takes. A `full` mockup is as wide as the chat.
- **Live, clickable pages in a pane.** Click, type and scroll in the page as in a browser. It reloads when its file changes, so you watch Claude's edits land. It works with dev servers such as `http://localhost:5173`, and in desktop, tablet or phone size.
- **A gallery of everything shown.** Every sketch, mockup, live page and artifact is kept across sessions, newest first, with a picture of each. Open any of them again, live or in your browser.
- **Artifacts in the terminal.** A plain HTML artifact that Claude publishes can be opened live in the pane too.
- **Your machine only.** Pictures, pages and the gallery stay in `~/.cache/ccglimpse/`. The plugin sends nothing anywhere.

## Requirements

| You need | Why |
|---|---|
| **kitty** or **Ghostty** | Pictures use the kitty graphics protocol with Unicode placeholders. Built and tested on kitty. |
| **Claude Code 2.1.326 or later**, in fullscreen mode | Fullscreen mode gives clicks and the pane beside the chat. Turn it on with `"tui": "fullscreen"` in `~/.claude/settings.json`. |
| **Chromium or Chrome** (or Brave) | Renders the pages. It runs hidden, with a throwaway profile, never your own. |
| **Node 22 or later** | Runs the live pane's small helper. |
| python3 (optional) | Measures your terminal's cell size so pictures keep their shape. Without it, 14x31 px is assumed. |

Built and tested on Linux. macOS is untested: there, the browser must be a command on your PATH (such as `chromium`), since an app in /Applications isn't found yet. Not tested inside tmux or screen.

## Install

In Claude Code, type:

```
/plugin marketplace add thomasmartinoa/ccglimpse
/plugin install ccglimpse@ccglimpse
```

Then start a new session, or run `/reload-plugins`.

Or from a shell:

```sh
claude plugin marketplace add thomasmartinoa/ccglimpse
claude plugin install ccglimpse@ccglimpse
```

Add `--scope project` to install it for one project only.

**Check that it works:** ask Claude "sketch a login page". A small picture should appear in the chat. Then type `/view` to open the gallery.

### Update

```sh
claude plugin marketplace update ccglimpse
claude plugin update ccglimpse@ccglimpse
```

Then restart Claude Code.

### Uninstall

```sh
claude plugin uninstall ccglimpse@ccglimpse
rm -rf ~/.cache/ccglimpse    # optional: the gallery, pictures and pages
```

## How to use it

### Just ask

You don't need special words. Ask the way you normally would, for example:

- "Sketch two layouts for the settings page."
- "Show me what the dashboard would look like."
- "Show me the phone version."
- "Let me click through the signup flow."
- "Open my dev server at localhost:5173 in phone size."
- "Show me the sketches from yesterday."

Claude picks the right tool: a small sketch for quick layout ideas, a full mockup for a screen to review, or the live pane when you want to click.

### Pictures in the chat

Under each picture there are three buttons:

- **open live**: the same page, clickable, in the pane.
- **browser**: open it in your normal browser.
- **gallery**: see everything shown so far.

### The live pane

The pane opens beside the chat. You can also open it yourself:

```
/view path/to/page.html            a file (reloads when the file changes)
/view http://localhost:5173 phone  a URL, in phone size
/view close                        close the pane
/view                              the gallery
```

In the pane:

- **Click into the page** to use it. Your keys then go to the page; **Esc** gives them back to the prompt.
- **Scroll** with the mouse wheel.
- **Top row**: ← back, → forward, ↻ reload, and an address box. Type a file path or URL there and press Enter.
- **Second row**: desktop / tablet / phone, open in your browser, and the gallery.
- Links that would open a new tab open in the same pane. A page's `alert()` or `confirm()` is answered for it, and its message shows in the status line.

If your terminal is narrower than 144 columns, the pane doesn't push in by itself. Widen the window to show it.

### The gallery

Type `/view`, or ask Claude for "the gallery".

- The list is at the top: `this project` shows what was made in the current folder, `all` shows everything. Use ↑ newer / ↓ older to page through it.
- Pick an entry to see its picture, with **open live**, **browser** and **remove**.
- A live page's picture is its last frame, taken while it was open.

### Artifacts

When Claude publishes an artifact from an HTML file, its row gets a **view here** button that opens the page live in the pane. You can also give Claude an artifact link and ask to see it here.

This works for plain HTML artifacts. Artifacts made from a type (Docs, Slides, Dashboard, Design) only run on claude.ai, and claude.ai doesn't load in a hidden browser, so for those Claude gives you the link instead.

### Several sessions at once

Each Claude Code session gets its own live browser, so you can have panes open in several windows. They all share one gallery.

## What it changes in Claude

Each session, the plugin adds a short note to Claude's instructions: show UI with these tools instead of ASCII drawings, and when to ask whether you want something in the terminal or as an artifact. Small and medium visuals show in the terminal without asking. For large work (a multi-page site, a design system, something to share), Claude asks first.

## Troubleshooting

| Problem | Try this |
|---|---|
| No picture, only text | Your terminal must be kitty or Ghostty. Check that Claude Code is 2.1.326 or later (`claude --version`). |
| "No Chromium or Chrome found" | Install Chromium, or Chrome. The plugin looks for `chromium`, `google-chrome-stable`, `google-chrome`, `brave` and `chrome` on your PATH. |
| The live pane doesn't show up | Turn on fullscreen mode (see Requirements), and widen the terminal to at least 144 columns. |
| Clicks in the pane do nothing | Fullscreen mode is needed for clicks. Click into the page first; Esc leaves it. |
| Pictures look squashed | Install python3, so the cell size can be measured. |
| Something else | Start Claude Code with `claude --debug` and try again: the reason shows in the debug log. |

## Your data

Everything stays on your machine, in `~/.cache/ccglimpse/`:

- `gallery.json`: the gallery list (up to 300 entries).
- `pages/`, `thumbs/` and the `.png` files: the pages and pictures.
- `live/`: one folder per session for its hidden browser, with a throwaway profile. Folders of sessions that ended are cleared the next time a live pane opens.

The browser never uses your own profile or logins. The plugin sends nothing over the network; a page you open loads whatever that page loads.

## How it works

| File | What it does |
|---|---|
| `hooks/register.tsx` | Entry point: the two tools (`preview`, `live`), `/view`, the note Claude reads, and the drawing hooks |
| `hooks/preview.ts` | Still pictures: `chromium --headless --screenshot`, and fitting the PNG to a box of cells |
| `hooks/live.tsx` | The live pane: starts the helper, swaps new frames into the picture, sends clicks and keys on |
| `hooks/gallery.ts` | The gallery list, kept in `~/.cache/ccglimpse/gallery.json` |
| `hooks/gallery-pane.tsx` | Draws the gallery pane |
| `hooks/pointer.tsx` | An invisible region over the picture that catches clicks and keys |
| `hooks/cells.ts` | Measures a terminal cell in pixels, so pictures keep their shape |
| `runtime/live-helper.mjs` | A small Node program that drives a hidden Chromium over the DevTools protocol, writes each new frame as a PNG, and takes input on a Unix socket |

## Develop

```sh
git clone https://github.com/thomasmartinoa/ccglimpse
```

In Claude Code, add your copy instead of the GitHub one:

```
/plugin marketplace add /path/to/ccglimpse
/plugin install ccglimpse@ccglimpse
```

Edits load with `/reload-plugins`. Before sending a change:

```sh
claude plugin validate .
claude plugin test .
```
