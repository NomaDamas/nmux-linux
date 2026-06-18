'use strict';
// Regression guards for the mouse/wheel binding failures:
//   #9  pane click → "'…/nmux-linux mouseup … ' returned 127"
//   #11 wheel-up   → returned 127 + a leaked Kitty-graphics payload
//                    arriving as a garbage argument
//
// Root cause: tmux runs `run-shell` / `display-popup` / hook commands
// through /bin/sh with a minimal PATH that excludes node's directory, so
// the binaries' `#!/usr/bin/env node` shebang failed with 127. The fix
// invokes node by absolute path and stops forwarding #{pane_title} (which
// can hold arbitrary bytes) on the binding command line.
//
// These assert on the source text because the binding strings are emitted
// from deep inside the CLI's setup path and aren't independently exported.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'bin', 'nmux-linux'), 'utf8');

test('node interpreter is invoked by absolute path for tmux commands (#9/#11)', () => {
  assert.match(SRC, /const NODE_BIN = process\.execPath;/,
    'NODE_BIN must be derived from process.execPath');
  assert.match(SRC, /const NMUX_RUN = `\$\{NODE_BIN\} \$\{NMUX_BIN\}`;/,
    'NMUX_RUN must prefix the script with the node interpreter');
});

test('mouse + wheel bindings run via NMUX_RUN, never the bare env-node script (#9)', () => {
  const mouseup = SRC.match(/bind-key -T root MouseUp1Pane run-shell[^\n]*/)[0];
  const wheelUp = SRC.match(/bind-key -T root WheelUpPane run-shell[^\n]*/)[0];
  const wheelDn = SRC.match(/bind-key -T root WheelDownPane run-shell[^\n]*/)[0];
  for (const [name, line] of [['MouseUp', mouseup], ['WheelUp', wheelUp], ['WheelDown', wheelDn]]) {
    assert.ok(line.includes('${NMUX_RUN}'),
      `${name} binding must invoke node via NMUX_RUN, got: ${line}`);
    assert.ok(!/\$\{NMUX_BIN\} (mouseup|wheel)/.test(line),
      `${name} binding must not invoke the bare env-node script: ${line}`);
  }
});

test('mouse + wheel bindings do not forward #{pane_title} on the command line (#11)', () => {
  const mouseup = SRC.match(/bind-key -T root MouseUp1Pane run-shell[^\n]*/)[0];
  const wheelUp = SRC.match(/bind-key -T root WheelUpPane run-shell[^\n]*/)[0];
  const wheelDn = SRC.match(/bind-key -T root WheelDownPane run-shell[^\n]*/)[0];
  for (const [name, line] of [['MouseUp', mouseup], ['WheelUp', wheelUp], ['WheelDown', wheelDn]]) {
    assert.ok(!line.includes('#{pane_title}'),
      `${name} binding must resolve the title in-process, not pass #{pane_title}: ${line}`);
    assert.ok(line.includes('#{pane_id}'),
      `${name} binding must still pass the safe #{pane_id}: ${line}`);
  }
});

test('the new-project popup execs node by absolute path (#10)', () => {
  // The display-popup -E shell also runs with the minimal PATH, so the
  // submit `exec` must not rely on the env-node shebang either.
  assert.match(SRC,
    /exec \$\{shQuote\(NODE_BIN\)\} \$\{shQuote\(NMUX_BIN\)\} open/,
    'new-project popup must exec node by absolute path');
});

test('finishing a manual border drag re-pins the fixed panes via fix-layout (#13)', () => {
  // Sidebar / right (progress) / sub widths are fixed; only main is meant to
  // be user-resizable. A border-drag-end must converge the layout so the
  // auxiliary text areas do not stay shifted after a drag. MouseDragEnd1Border
  // is a one-shot user gesture (fix-layout's own resize-pane never emits it),
  // so it cannot recurse into a hook-storm the way after-resize-pane would.
  const drag = SRC.match(/bind-key -T root MouseDragEnd1Border[^\n]*/);
  assert.ok(drag, 'a MouseDragEnd1Border binding must exist');
  assert.ok(drag[0].includes('${NMUX_RUN}') && drag[0].includes('fix-layout'),
    `border-drag binding must run fix-layout via NMUX_RUN: ${drag[0]}`);
  assert.doesNotMatch(SRC, /set-hook -g after-resize-pane/,
    'after-resize-pane must not be hooked (it storms from fix-layout resizes)');
});
