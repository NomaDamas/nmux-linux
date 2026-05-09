#!/usr/bin/env bash
# nmux-linux installer.
#
# What it does (Linux only):
#   1) Verifies / installs prerequisites: tmux >= 3.0, node, notify-send, paplay.
#   2) Installs `nmux-linux` and `nmux-linux-sidebar` into ${PREFIX}/bin
#      (default: $HOME/.local/bin) with their shebangs pinned to an
#      absolute node path so tmux hooks (whose PATH is bare) can still
#      execute them.
#   3) Drops ~/.bashrc.d/nmux-linux.sh so plain `tmux` (no args) launches
#      nmux-linux. Skip with --no-bashrc. The shim is PATH-driven and
#      assumes ${PREFIX}/bin is on PATH; pass --auto-source-bashrc-d to
#      have the installer append a (targeted) sourcing loop to ~/.bashrc
#      if it's not already present.
#   4) (Optional) Wires Claude Code Stop / SubagentStop / Notification /
#      UserPromptSubmit hooks in ~/.claude/settings.json so agent-finish
#      indicators work out of the box.
#   5) (Optional) Patches oh-my-codex (omx) to honor the
#      ~/.config/nmux-linux/disable-hud-omx marker so omx's auto HUD
#      pane doesn't fight the nmux-linux layout.
#
# Flags:
#   --no-deps                Skip prerequisite install attempts.
#   --no-bashrc              Skip writing ~/.bashrc.d/nmux-linux.sh.
#   --auto-source-bashrc-d   Append a `for f in ~/.bashrc.d/*.sh` loop to
#                            ~/.bashrc only if no `bashrc.d` is mentioned
#                            there yet. Off by default.
#   --no-claude-hooks        Skip Claude Code hook setup.
#   --no-omx-patch           Skip omx HUD opt-out.
#   --node BIN               Use BIN as the absolute node path (default: auto-detect).
#   --prefix DIR             Install bin under DIR (default: $HOME/.local).
#   --yes                    Non-interactive: assume yes for sudo prompts when needed.

set -euo pipefail

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PREFIX="${HOME}/.local"
DO_DEPS=1
DO_BASHRC=1
DO_CLAUDE=1
DO_OMX=1
DO_AUTO_SOURCE=0
ASSUME_YES=0
NODE_BIN=""

while [ $# -gt 0 ]; do
  case "$1" in
    --no-deps)              DO_DEPS=0; shift ;;
    --no-bashrc)            DO_BASHRC=0; shift ;;
    --auto-source-bashrc-d) DO_AUTO_SOURCE=1; shift ;;
    --no-claude-hooks)      DO_CLAUDE=0; shift ;;
    --no-omx-patch)         DO_OMX=0; shift ;;
    --yes)                  ASSUME_YES=1; shift ;;
    --node)                 NODE_BIN="$2"; shift 2 ;;
    --prefix)               PREFIX="$2"; shift 2 ;;
    -h|--help)
      sed -nE 's/^# ?//p' "$0" | head -45
      exit 0 ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done

DEST_BIN="${PREFIX}/bin"
DEST_SHARE="${PREFIX}/share/nmux-linux"
DEST_BASHRC_D="${HOME}/.bashrc.d"

log()  { printf '[nmux-linux] %s\n' "$*"; }
warn() { printf '[nmux-linux] %s\n' "$*" >&2; }
die()  { printf '[nmux-linux] %s\n' "$*" >&2; exit 1; }

# ---- 1) prerequisites ----
detect_pkg_manager() {
  for cmd in apt-get dnf yum pacman zypper apk; do
    if command -v "$cmd" >/dev/null 2>&1; then echo "$cmd"; return; fi
  done
  echo ""
}

ensure_tool() {
  local bin="$1" pkg="$2"
  if command -v "$bin" >/dev/null 2>&1; then return 0; fi
  warn "missing: $bin"
  [ "$DO_DEPS" -eq 1 ] || { warn "skip install (--no-deps); please install $bin manually"; return 1; }
  local pm; pm="$(detect_pkg_manager)"
  [ -n "$pm" ] || { warn "no recognized package manager; install $bin manually"; return 1; }
  local sudo=""; [ "$(id -u)" -eq 0 ] || sudo="sudo"
  case "$pm" in
    apt-get) $sudo apt-get update -y && $sudo apt-get install -y "$pkg" ;;
    dnf|yum) $sudo "$pm" install -y "$pkg" ;;
    pacman)  $sudo pacman -Sy --noconfirm "$pkg" ;;
    zypper)  $sudo zypper install -y "$pkg" ;;
    apk)     $sudo apk add --no-cache "$pkg" ;;
  esac
}

ensure_tmux_recent() {
  ensure_tool tmux tmux || die "tmux required"
  local ver; ver="$(tmux -V 2>/dev/null | awk '{print $2}')"
  case "$ver" in
    3.*|4.*|next-*|master) ;;
    *) warn "tmux $ver detected — recommend 3.0+ (some bindings may be flaky)";;
  esac
}

ensure_node() {
  if [ -n "$NODE_BIN" ]; then
    [ -x "$NODE_BIN" ] || die "--node $NODE_BIN is not executable"
    return 0
  fi
  if ! command -v node >/dev/null 2>&1; then
    ensure_tool node nodejs || ensure_tool node node || die "node required"
  fi
  NODE_BIN="$(command -v node)"
  NODE_BIN="$(readlink -f "$NODE_BIN")"
}

ensure_optional() {
  ensure_tool notify-send libnotify-bin    || warn "notify-send missing → desktop toasts disabled"
  ensure_tool paplay      pulseaudio-utils || warn "paplay missing → completion sound disabled"
}

# ---- 2) install scripts ----
install_scripts() {
  mkdir -p "$DEST_BIN" "$DEST_SHARE"
  for name in nmux-linux nmux-linux-sidebar; do
    local src="$SRC_DIR/bin/$name"
    local dst="$DEST_BIN/$name"
    [ -f "$src" ] || die "missing source: $src"
    cp "$src" "$dst"
    sed -i "1c#!${NODE_BIN}" "$dst"
    chmod +x "$dst"
    log "installed $dst"
  done
  cp "$SRC_DIR/share/nmux-linux.bashrc.sh" "$DEST_SHARE/nmux-linux.bashrc.sh"
}

# ---- 3) bashrc snippet ----
install_bashrc() {
  [ "$DO_BASHRC" -eq 1 ] || { log "skip bashrc snippet (--no-bashrc)"; return; }
  mkdir -p "$DEST_BASHRC_D"
  if [ -e "$DEST_BASHRC_D/nmux-linux.sh" ]; then
    log "$DEST_BASHRC_D/nmux-linux.sh already exists — leaving untouched"
  else
    cp "$SRC_DIR/share/nmux-linux.bashrc.sh" "$DEST_BASHRC_D/nmux-linux.sh"
    log "installed $DEST_BASHRC_D/nmux-linux.sh"
  fi

  # Only append a ~/.bashrc.d sourcer if explicitly asked AND ~/.bashrc
  # doesn't already mention bashrc.d. We DON'T modify ~/.bashrc by
  # default — auto-sourcing every readable file in ~/.bashrc.d is a
  # behavior change a careful user may not want.
  local bashrc="$HOME/.bashrc"
  if [ "$DO_AUTO_SOURCE" -eq 1 ] && [ -f "$bashrc" ] && ! grep -q 'bashrc\.d' "$bashrc" 2>/dev/null; then
    {
      echo ''
      echo '# nmux-linux: source ~/.bashrc.d/nmux-linux.sh (added by install.sh --auto-source-bashrc-d)'
      echo '[ -r "$HOME/.bashrc.d/nmux-linux.sh" ] && . "$HOME/.bashrc.d/nmux-linux.sh"'
    } >> "$bashrc"
    log "appended targeted nmux-linux source line to $bashrc"
  elif [ "$DO_AUTO_SOURCE" -eq 0 ]; then
    if [ -f "$bashrc" ] && ! grep -q 'bashrc\.d' "$bashrc" 2>/dev/null; then
      log "your ~/.bashrc does not source ~/.bashrc.d — to enable the tmux shim, add"
      log "    [ -r \"\$HOME/.bashrc.d/nmux-linux.sh\" ] && . \"\$HOME/.bashrc.d/nmux-linux.sh\""
      log "  to ~/.bashrc, or rerun with --auto-source-bashrc-d."
    fi
  fi
}

# ---- 4) Claude Code hooks ----
install_claude_hooks() {
  [ "$DO_CLAUDE" -eq 1 ] || { log "skip claude hooks (--no-claude-hooks)"; return; }
  local settings="$HOME/.claude/settings.json"
  [ -f "$settings" ] || { log "no $settings — skip Claude Code integration"; return; }
  command -v node >/dev/null 2>&1 || { warn "node missing → cannot edit Claude settings"; return; }
  cp "$settings" "$settings.bak.nmux-linux-$(date +%Y%m%d-%H%M%S)"
  NMUX_BIN_PATH="$DEST_BIN/nmux-linux" node "$SRC_DIR/share/install-claude-hooks.js" "$settings"
  log "wired Claude Code hooks in $settings (backup saved alongside)"
}

# ---- 5) omx HUD opt-out ----
install_omx_optout() {
  [ "$DO_OMX" -eq 1 ] || { log "skip omx HUD opt-out (--no-omx-patch)"; return; }
  local out
  if out="$("$DEST_BIN/nmux-linux" disable-omx-hud 2>&1)"; then
    log "omx HUD opt-out applied"
    printf '%s\n' "$out"
  else
    warn "omx HUD opt-out reported failure — see output below:"
    printf '%s\n' "$out" >&2
    warn "(the marker file is still in place; run \`nmux-linux disable-omx-hud\` again after omx is installed/upgraded)"
  fi
}

# ---- main ----
ensure_tmux_recent
ensure_node
ensure_optional
install_scripts
install_bashrc
install_claude_hooks
install_omx_optout

cat <<MSG

[nmux-linux] Done. Quick start:
  - Make sure ${DEST_BIN} is on \$PATH.
  - Open a new shell (or \`source ~/.bashrc\`).
  - Type \`tmux\`. With nothing else open, the launcher boots a fresh
    nmux-linux session whose first window is the most-recent project
    in ~/projects (or whichever project you ran \`nmux-linux open <path>\`
    on last).
  - Click sidebar rows to switch / close projects, click "+ new project"
    to register a path, "⊗ kill nmux-linux" to tear down the session.

Reverse:
  ${SRC_DIR}/uninstall.sh

MSG
