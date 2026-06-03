#!/usr/bin/env bash
# Inside-container smoke test: run install.sh on a clean box, then drive
# nmux-linux non-interactively to verify the install actually works.

set -euo pipefail

cd "$(dirname "$0")/.."

step() { printf '\n=== %s ===\n' "$*"; }

# Use a tmux server isolated to this test so we don't collide with anything
# else running on the host (relevant when smoke.sh is run without a
# container). Also shadow git config in case the env has none.
export TMUX_TMPDIR="${TMUX_TMPDIR:-/tmp/nmux-smoke-tmux}"
export GIT_AUTHOR_NAME="${GIT_AUTHOR_NAME:-nmux-test}"
export GIT_AUTHOR_EMAIL="${GIT_AUTHOR_EMAIL:-nmux-test@example.com}"
export GIT_COMMITTER_NAME="$GIT_AUTHOR_NAME"
export GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"
mkdir -p "$TMUX_TMPDIR"

step "1. install.sh --yes (no Claude / no omx)"
./install.sh --yes --no-claude-hooks --no-omx-patch

# Bring binaries into PATH for non-login shells.
export PATH="$HOME/.local/bin:$PATH"

step "2. binaries resolve"
command -v nmux-linux         || { echo "nmux-linux not on PATH"; exit 1; }
command -v nmux-linux-sidebar || { echo "nmux-linux-sidebar not on PATH"; exit 1; }
nmux-linux help | head -5

step "3. node syntax check on installed binaries"
node -c "$HOME/.local/bin/nmux-linux"
node -c "$HOME/.local/bin/nmux-linux-sidebar"

step "4. init writes projects.json"
mkdir -p "$HOME/projects/sample-a" "$HOME/projects/sample-b"
( cd "$HOME/projects/sample-a" && git init -q && git commit -q --allow-empty -m init )
( cd "$HOME/projects/sample-b" && git init -q && git commit -q --allow-empty -m init )
nmux-linux init --force
test -f "$HOME/.config/nmux-linux/projects.json" || { echo "projects.json missing"; exit 1; }
node -e 'const c=require(process.env.HOME+"/.config/nmux-linux/projects.json"); if(!Array.isArray(c.projects)||c.projects.length<2){console.error("expected ≥2 projects",c);process.exit(1)}'
echo "projects.json ok"

step "5. apply (build session) + status"
nmux-linux apply
tmux has-session -t nmux-linux
nmux-linux status
nmux-linux save-state
test -f "$HOME/.config/nmux-linux/state.json" || { echo "state.json missing"; exit 1; }

step "6. sidebar process rendered + per-pane clickmap written"
sleep 1.5
ls "$HOME/.config/nmux-linux/clickmaps" >/dev/null 2>&1 || { echo "clickmaps dir missing"; exit 1; }
n=$(find "$HOME/.config/nmux-linux/clickmaps" -name '*.txt' | wc -l)
[ "$n" -ge 1 ] || { echo "no clickmap files written"; exit 1; }
echo "clickmaps: $n file(s)"

step "7. notify pipeline (no desktop in container, but tmux state must update)"
FIRST_PROJ=$(tmux list-windows -t nmux-linux -F '#{@nmuxlinux_project}' | head -1)
nmux-linux notify --project "$FIRST_PROJ" --status running --message "build" >/dev/null
got=$(tmux show-window-options -t "nmux-linux:1" @nmuxlinux_status 2>&1 | awk '{print $2}' | tr -d '"')
[ "$got" = "running" ] || { echo "expected status=running, got: $got"; exit 1; }
nmux-linux notify --project "$FIRST_PROJ" --status done --message "ok" >/dev/null
got=$(tmux show-window-options -t "nmux-linux:1" @nmuxlinux_status 2>&1 | awk '{print $2}' | tr -d '"')
[ "$got" = "done" ] || { echo "expected status=done, got: $got"; exit 1; }
echo "notify ok"

step "8. clear-status zeroes it back"
nmux-linux clear-status --project "$FIRST_PROJ"
got=$(tmux show-window-options -t "nmux-linux:1" @nmuxlinux_status 2>&1 | awk '{print $2}' | tr -d '"')
[ "$got" = "idle" ] || { echo "expected status=idle, got: $got"; exit 1; }
echo "clear-status ok"

step "9. right-top preview command reuses existing pane"
before=$(tmux list-panes -t nmux-linux:1 | wc -l)
nmux-linux preview --cmd 'printf preview-ready; sleep 30'
after=$(tmux list-panes -t nmux-linux:1 | wc -l)
[ "$before" = "$after" ] || { echo "preview changed pane count: before=$before after=$after"; exit 1; }
tmux list-panes -t nmux-linux:1 -F '#{pane_title}' | grep -qx 'webview' || { echo "webview pane title missing"; exit 1; }
echo "preview ok"

step "10. status includes pane details"
nmux-linux status | grep -q 'webview' || { echo "status missing pane details"; exit 1; }
echo "status pane details ok"

step "11. open new project (auto-mkdir)"
nmux-linux open "$HOME/projects/sample-c-fresh"
test -d "$HOME/projects/sample-c-fresh" || { echo "auto-mkdir failed"; exit 1; }
nmux-linux status

step "12. close-window keeps session alive"
LAST=$(tmux list-windows -t nmux-linux -F '#{window_index}' | tail -1)
nmux-linux close-window "$LAST" || true
sleep 0.5
nmux-linux status

step "13. kill teardown"
nmux-linux kill
tmux has-session -t nmux-linux 2>/dev/null && { echo "session still running"; exit 1; } || true

echo
echo "ALL GREEN"
