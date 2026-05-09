# nmux-linux — auto-launch the nmux-linux session when `tmux` is run with
# no args. `command tmux ...` always reaches stock tmux. The shim is
# PATH-driven so it works regardless of installer --prefix.

if command -v nmux-linux >/dev/null 2>&1; then
  tmux() {
    if [ $# -eq 0 ]; then
      command nmux-linux launch
    else
      command tmux "$@"
    fi
  }
fi
