const test = require('node:test');
const assert = require('node:assert/strict');

const sidebar = require('../bin/nmux-linux-sidebar');

test('parseRows decodes tmux list-windows output', () => {
  const rows = sidebar.parseRows('1\tproj-a\t1\trunning\tproj-a\tbuild\n2\tproj-b\t0\tidle\t\t');
  assert.deepEqual(rows, [
    { i: '1', n: 'proj-a', a: true, s: 'running', p: 'proj-a', m: 'build' },
    { i: '2', n: 'proj-b', a: false, s: 'idle', p: 'proj-b', m: '' },
  ]);
});

test('buildSidebarFrame is deterministic and keeps clickmap stable across spinner frames', () => {
  const input = {
    rows: [{ i: '1', n: 'proj-a', a: true, s: 'running', p: 'proj-a', m: '' }],
    registry: [{ name: 'proj-a' }, { name: 'proj-b' }],
    discover: [{ name: 'proj-c' }],
    width: 26,
  };
  const a = sidebar.buildSidebarFrame({ ...input, frame: 0 });
  const b = sidebar.buildSidebarFrame({ ...input, frame: 0 });
  const c = sidebar.buildSidebarFrame({ ...input, frame: 1 });

  assert.equal(a.body, b.body);
  assert.equal(a.clickmap, b.clickmap);
  assert.notEqual(a.body, c.body, 'spinner frame should repaint the body');
  assert.equal(a.clickmap, c.clickmap, 'spinner-only changes must not rewrite row mapping');
  assert.match(a.clickmap, /^2\tswitch\t1\t0/m);
  assert.doesNotMatch(a.body, /\x1b\[2J/, 'frame body must not force a full clear');
  assert.match(a.body, /\x1b\[K/, 'frame body should clear to end of line');
});

test('terminalFrame wraps output in synchronized update sequence', () => {
  const out = sidebar.terminalFrame('body');
  assert.ok(out.startsWith('\x1b[?2026h\x1b[2J\x1b[H'));
  assert.ok(out.endsWith('\x1b[?2026l'));
});
