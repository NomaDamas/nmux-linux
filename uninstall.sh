#!/usr/bin/env bash
# nmux-linux uninstaller.
#
# Removes the binaries and bashrc snippet. Leaves ~/.config/nmux-linux/
# (your project registry, sidebar state, HUD opt-out marker) intact unless
# you pass --purge. Claude Code settings.json is NOT modified — back it up
# yourself if you want to undo the hooks.

set -euo pipefail

PREFIX="${HOME}/.local"
PURGE=0
RESTORE_OMX=0

while [ $# -gt 0 ]; do
  case "$1" in
    --prefix)      PREFIX="$2"; shift 2 ;;
    --purge)       PURGE=1; shift ;;
    --restore-omx) RESTORE_OMX=1; shift ;;
    -h|--help)
      sed -nE 's/^# ?//p' "$0" | head -20; exit 0 ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done

DEST_BIN="${PREFIX}/bin"
DEST_SHARE="${PREFIX}/share/nmux-linux"

log() { printf '[nmux-linux uninstall] %s\n' "$*"; }

# Tear down running session if present.
if command -v tmux >/dev/null 2>&1 && tmux has-session -t nmux-linux 2>/dev/null; then
  log "killing live nmux-linux tmux session"
  tmux kill-session -t nmux-linux || true
fi

# Restore omx HUD reconciler before removing nmux-linux (so the
# `nmux-linux enable-omx-hud` command is still around).
if [ "$RESTORE_OMX" -eq 1 ] && [ -x "$DEST_BIN/nmux-linux" ]; then
  "$DEST_BIN/nmux-linux" enable-omx-hud || true
fi

# Remove binaries.
for f in nmux-linux nmux-linux-sidebar; do
  if [ -e "$DEST_BIN/$f" ]; then
    rm -f "$DEST_BIN/$f"
    log "removed $DEST_BIN/$f"
  fi
done
rm -rf "$DEST_SHARE"

# Remove bashrc snippet (non-destructive: only deletes our own file).
if [ -e "$HOME/.bashrc.d/nmux-linux.sh" ]; then
  rm -f "$HOME/.bashrc.d/nmux-linux.sh"
  log "removed $HOME/.bashrc.d/nmux-linux.sh"
fi

if [ "$PURGE" -eq 1 ]; then
  rm -rf "$HOME/.config/nmux-linux"
  log "purged ~/.config/nmux-linux"
fi

cat <<MSG
[nmux-linux uninstall] Done.
  - Claude Code settings.json hooks were NOT touched. Search for
    "nmux-linux notify-current" lines in $HOME/.claude/settings.json
    and remove them manually if you wired Claude integration.
  - omx (oh-my-codex) reconcile.js / hud/tmux.js patches were $(
    [ "$RESTORE_OMX" -eq 1 ] && echo "removed via enable-omx-hud" \
                              || echo "left in place; run \`nmux-linux enable-omx-hud\` BEFORE uninstall to undo, or upgrade omx to overwrite"
  ).
MSG
