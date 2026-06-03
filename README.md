# nmux-linux

**Nomadamas Open Source · a Linux-native tmux front-end for multi-project agent workspaces.**

cmux-style workflows are compelling, but Linux users should not have to
wait for a dedicated desktop front-end to get a fast, keyboard-native
multi-session cockpit. `nmux-linux` turns plain tmux into a project-aware
workspace: a live clickable sidebar, a main coding pane, and managed
right-side panes for agent status, shell work, and previews.

It is intentionally small: no daemon, no cloud service, no GUI runtime.
Just tmux, Node.js, and a layout that makes multiple coding-agent
sessions feel like one coherent Linux workbench.

```
┌────────────┬──────────────────────────┬─────────────┐
│ nmux-linux │   main coding pane       │  right-top  │
│ ─────────  │                          │             │
│ ▸1 ✓ proj1 │   $ pytest               ├─────────────┤
│  2 … proj2 │   ...                    │  right-bot  │
│  3   proj3 │                          │             │
│            │                          │             │
│ closed     │                          │             │
│   proj4    │                          │             │
│ new        │                          │             │
│   ideabox  │                          │             │
│ + new      │                          │             │
│ ⊗ kill     │                          │             │
└────────────┴──────────────────────────┴─────────────┘
```

## What you get

- **One tmux window per project** — the registry lives in
  `~/.config/nmux-linux/projects.json`.
- **Live sidebar pane** with three lists — open windows, registered-but-
  closed projects (click to reopen), and discoverable subfolders under
  `~/projects` that aren't projects yet (click to register + open).
- **Mouse navigation** — clicking a project row switches to its window,
  the trailing `×` closes the window, `+ new project` opens a tmux
  command-prompt for a name or path, `⊗ kill nmux-linux` confirms +
  tears the whole session down.
- **3-column default layout per window** — sidebar (fixed 24-cell
  width, pinned via tmux hooks even after attach/resize) | main shell
  (covers sidebar→middle) | right column split into managed top/bottom panes. The
  top-right/status pane can be reused as a managed preview/webview slot.
- **Open-set persistence** — the sidebar writes the list of currently
  open windows to `~/.config/nmux-linux/state.json` every 0.5s. Next
  `nmux-linux launch` re-creates exactly that set.
- **Loud agent-finish indicators** — when an agent finishes a turn its
  sidebar row turns into a black-on-green block; on failure a
  white-on-red block; on need-input a black-on-yellow block. The block
  persists until you visit that window (a tmux `after-select-window`
  hook clears the status).
- **Animated running spinner** — `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` on rows whose agent is
  currently working.
- **Desktop notification + sound** on finish (`notify-send` +
  `paplay`).
- **Claude Code integration (optional)** — `Stop`, `SubagentStop`,
  `Notification`, `UserPromptSubmit`, `PreToolUse` hooks fire
  `nmux-linux notify-current` so the sidebar is fully driven by what
  Claude is actually doing.
- **omx (oh-my-codex) HUD opt-out (optional)** — patches `reconcile.js`
  and `hud/tmux.js` to honor a marker file at
  `~/.config/nmux-linux/disable-hud-omx`, and `fix-layout`/
  `clean-omx-hud` remove definite stale `omx hud --watch` panes so omx
  stops leaving a HUD pane below your main pane.
- **Right-pane preview MVP** — `nmux-linux preview` / `webview` reuses
  the managed top-right pane for a terminal browser, a user-supplied command, or
  `xdg-open` external handoff without creating extra panes.

No daemon, no external services. Two Node.js scripts plus a couple of
shell shims.

## Requirements

- Linux (uses `notify-send`, `paplay`, `/proc`, freedesktop sound files).
- `tmux` ≥ 3.0 (tested on 3.4).
- `node` (any reasonably modern version).
- `bash` (for the launcher / installer).

`notify-send` and `paplay` are optional — if missing, desktop toast and
sound are disabled but everything else works.

## Install

```bash
git clone https://github.com/<your-org-or-user>/nmux-linux.git
cd nmux-linux
./install.sh
```

The installer:

1. Verifies `tmux`, `node`, `notify-send`, `paplay`. Missing ones are
   installed via the system package manager (apt / dnf / pacman /
   zypper / apk) when possible — pass `--no-deps` to skip this.
2. Copies `bin/nmux-linux` and `bin/nmux-linux-sidebar` into
   `$HOME/.local/bin/`, with each shebang rewritten to the absolute
   `node` path so tmux hooks (whose `PATH` is bare) can still execute
   them.
3. Drops `~/.bashrc.d/nmux-linux.sh`. `tmux` with no args now boots
   nmux-linux; `command tmux ...` still gets you stock tmux.
4. Wires Claude Code hooks in `~/.claude/settings.json` if that file
   exists. Skip with `--no-claude-hooks`.
5. Patches omx (`oh-my-codex`) HUD reconciler if installed — skip with
   `--no-omx-patch`.

Useful flags:

```
--prefix DIR        install bin/share under DIR (default: $HOME/.local)
--node BIN          use BIN as the absolute node path
--no-deps           skip prerequisite install attempts
--no-bashrc         skip the bashrc.d/nmux-linux.sh shim
--no-claude-hooks   skip the Claude Code settings.json hooks
--no-omx-patch      skip the omx HUD opt-out
--yes               non-interactive
```

## Uninstall

```bash
./uninstall.sh
# add --purge to delete ~/.config/nmux-linux too
# add --restore-omx to revert the omx reconcile patch first
```

## Usage

```
nmux-linux                 launch + attach (default)
nmux-linux launch          idem
nmux-linux init [--force]  rescan configured project roots for git repos
nmux-linux apply [--replace]  rebuild session from the persisted open-set
nmux-linux refresh         reapply tmux options/bindings to a running session
nmux-linux refresh-sidebars  respawn sidebar panes after a code update
nmux-linux status          print session state + persisted open-set
nmux-linux kill            kill the nmux-linux session (state is auto-saved)
nmux-linux open <name|path>     open project as window (auto-registers if path)
nmux-linux close-current        close current window (saves state)
nmux-linux relayout             rebuild current window into sidebar | main | right(top/bottom)
nmux-linux fix-layout           re-pin sidebar width across windows (called by hooks)
nmux-linux clean-omx-hud        remove definite stale omx HUD panes
nmux-linux preview <url|cmd>    show preview in the managed top-right pane (alias: webview)
nmux-linux preview --external <url>  open URL with xdg-open
nmux-linux preview --cmd <cmd>       run a user command in the managed top-right pane
nmux-linux disable-omx-hud      patch omx + write the HUD opt-out marker
nmux-linux enable-omx-hud       remove marker (patches stay; harmless)
nmux-linux save-state           persist current open-windows to state.json
nmux-linux add <name> <path>    append to registry
nmux-linux rm <name>            remove from registry
nmux-linux notify --project N --status done|failed|need-input|running [--message M]
nmux-linux notify-current --status ...   resolve project from current $TMUX pane
nmux-linux clear-status --project N      reset status to idle (called by hooks on visit)
```


### Right-pane preview / webview MVP

`nmux-linux preview` (alias: `nmux-linux webview`) turns the existing
managed top-right pane into a preview slot. It never creates another
pane, and by default focus returns to the main coding pane.

```bash
# URL preview using the first installed terminal browser: w3m, lynx, elinks, links
nmux-linux preview http://localhost:5173

# Hand the URL to your desktop browser instead
nmux-linux preview --external http://localhost:5173

# Run any preview command in the managed top-right pane
nmux-linux preview --cmd 'npm run dev -- --host 127.0.0.1'

# Keep focus on the preview pane
nmux-linux preview --focus http://localhost:5173
```

This is a terminal-native MVP, not a true GUI/Electron webview. Modern
JS-heavy apps will usually need `--external` or a custom `--cmd`; richer
cmux-style browser embedding is intentionally deferred until the
terminal workflow is proven useful.

In a running session:

| key            | action                                    |
|----------------|-------------------------------------------|
| click sidebar  | switch / close / reopen / start / kill    |
| `M-1` … `M-9`  | switch to window 1–9 (default tmux key)   |
| `prefix C`     | new project prompt                        |
| `prefix X`     | close current window                      |

## How it works

- A single tmux session named `nmux-linux` holds one window per project.
- Each window is laid out as **sidebar | main | right(top/bottom)**.
- The sidebar pane runs `nmux-linux-sidebar`, which polls
  `tmux list-windows` every 0.5s, rewrites
  `~/.config/nmux-linux/clickmaps/<pane>.txt` (mapping screen rows +
  column ranges to actions), and persists the open-set. The renderer
  avoids full clears after the first paint and wraps updates in terminal
  synchronized-output markers when supported.
- A `MouseDown1Pane` binding scoped to `pane_title=nmux-linux-sidebar`
  forwards `mouse_y` + `mouse_x` to `nmux-linux click <y> <x>`, which
  dispatches to switch / close / reopen / add / kill.
- `nmux-linux notify` writes per-window user options
  (`@nmuxlinux_status`, `@nmuxlinux_message`) so the sidebar can render
  status icons + a one-line message, and fires `notify-send` + a
  freedesktop sound on the side.
- A `client-attached` / `window-resized` hook calls
  `nmux-linux fix-layout` so the sidebar pane keeps its configured
  cell-width across terminal resizes (tmux otherwise scales panes
  proportionally).
- An `after-select-window` hook calls `nmux-linux clear-status` to
  reset the loud done/failed/need-input block once the user actually
  visits the window.

## Files & directories

```
~/.local/bin/nmux-linux            # main script
~/.local/bin/nmux-linux-sidebar    # sidebar renderer
~/.local/share/nmux-linux/         # bashrc.sh source
~/.bashrc.d/nmux-linux.sh          # tmux() shim
~/.config/nmux-linux/projects.json # registry
~/.config/nmux-linux/state.json    # open-set + lastActive
~/.config/nmux-linux/clickmaps/   # per-sidebar-pane row → action maps
~/.config/nmux-linux/disable-hud-omx  # omx HUD opt-out marker (if enabled)
```

## License

MIT.
