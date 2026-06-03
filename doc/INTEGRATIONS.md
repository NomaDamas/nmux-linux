# Integrations

## Claude Code

`install.sh` writes five hooks into `~/.claude/settings.json` (a backup
is dropped next to the file). Each is idempotent — re-running the
installer does not duplicate them.

| Event             | Status set    | Message              |
|-------------------|---------------|----------------------|
| UserPromptSubmit  | `running`     | "in progress"        |
| PreToolUse        | `running`     | "tool running"       |
| Notification      | `need-input`  | "agent awaiting input" |
| SubagentStop      | `done`        | "subagent finished"  |
| Stop              | `done`        | "agent finished"     |

The hook command is:

```
${HOME}/.local/bin/nmux-linux notify-current --status <S> --message '<M>' >/dev/null 2>&1 || true
```

The `notify-current` resolver reads `#{@nmuxlinux_project}` from the
window the Claude Code process is running inside, falling back to the
window name. The status flips drive the sidebar visuals; the loud
`done` / `failed` / `need-input` block stays put until the user visits
that window, at which point the `after-select-window` hook clears it
back to `idle`.

Skip Claude Code wiring entirely:

```
./install.sh --no-claude-hooks
```

## omx (oh-my-codex) HUD opt-out

omx ships a HUD pane that splits at the bottom of every window the
moment a Codex prompt is submitted (via `reconcileHudForPromptSubmit`)
and the moment Codex is launched inside an existing tmux session (via
the `inside-tmux` branch of `launchWithHud`, which calls
`createHudWatchPane` directly).

`nmux-linux disable-omx-hud` (called by the installer when omx is
detected) does three things:

1. **Writes the marker file** `~/.config/nmux-linux/disable-hud-omx`.
2. **Patches `<omx>/dist/hud/reconcile.js`** to short-circuit at the
   top of `reconcileHudForPromptSubmit` when the marker exists or
   `NMUX_LINUX_DISABLE_HUD=1` is in the environment.
3. **Patches `<omx>/dist/hud/tmux.js`** so that `createHudWatchPane`
   itself returns `null` early under the same conditions. This is the
   single chokepoint every HUD-spawning code path funnels through.

Both patches are idempotent — they detect their own marker tokens
(`__nmuxlinux_existsSync`, `__nmuxlinux_hudSuppressed`) and no-op if
already applied. At runtime, `nmux-linux fix-layout` also calls the same
strict process-tree detector used by `nmux-linux clean-omx-hud` when the
marker/env suppression switch is active, so stale `omx hud --watch`
panes can be removed without touching unrelated panes.

The omx package path is resolved at runtime by:

1. Following `which omx` → `realpath` → walking up to find a
   `lib/node_modules/oh-my-codex/` next to it.
2. Asking `npm root -g` and joining `oh-my-codex`.
3. Trying `~/.local/lib/node_modules/oh-my-codex`,
   `/usr/local/lib/node_modules/oh-my-codex`,
   `/usr/lib/node_modules/oh-my-codex`.

If omx isn't installed, the patch step is skipped silently. If you
install omx later, run `nmux-linux disable-omx-hud` once to apply the
patches.

To re-enable omx HUD:

```
nmux-linux enable-omx-hud
```

This deletes the marker and unsets the session env. The patches stay
on disk (they're harmless when no marker / env is set) so a future
omx upgrade can overwrite them naturally.

## tmux server / session

nmux-linux uses a single tmux session named `nmux-linux`. It coexists
with any other tmux sessions you have. Bindings installed by
nmux-linux:

- `MouseDown1Pane` (root table) — global key, but the bound command
  is gated on `session_name == nmux-linux && pane_title == nmux-linux-sidebar`,
  so other sessions retain default click behavior.
- `prefix C` — overridden in the prefix table, calls
  `nmux-linux prompt`.
- `prefix X` — overridden in the prefix table, calls
  `nmux-linux close-current`.

Hooks installed (all global, all gate themselves on either project
arg or hook target):

- `client-attached`, `client-resized`, `window-resized`,
  `after-split-window` — call `nmux-linux fix-layout`.
- `after-select-window`, `session-window-changed` — call
  `nmux-linux clear-status --project #{@nmuxlinux_project}`.
- `alert-bell` — call `nmux-linux notify --project '#{@nmuxlinux_project}' --status done --message bell`.

Disable bell-driven notify by `tmux set-window-option -g monitor-bell off`.


## Right-pane preview / webview MVP

`nmux-linux preview` and its alias `nmux-linux webview` reuse the
existing managed top-right pane as a preview slot. They do not split
tmux or create extra panes.

Modes:

- `nmux-linux preview <url>`: run the first available terminal browser
  among `w3m`, `lynx`, `elinks`, and `links`.
- `nmux-linux preview --external <url>`: use `xdg-open` and leave tmux
  pane layout unchanged.
- `nmux-linux preview --cmd <command>`: respawn the managed top-right pane with a
  user-supplied command.
- Add `--focus` to leave focus in the preview pane; otherwise focus
  returns to the main pane.

This is deliberately terminal-native. It is useful for simple HTML, logs,
local server commands, and external browser handoff, but it is not a
full GUI/Electron webview like cmux may provide.
