const test = require('node:test');
const assert = require('node:assert/strict');

const sidebar = require('../bin/nmux-linux-sidebar');
const stripAnsi = s => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');

test('parseRows decodes tmux list-windows output', () => {
  const rows = sidebar.parseRows('1\tproj-a\t1\trunning\tproj-a\tbuild\t123\n2\tproj-b\t0\tidle\t\t');
  assert.deepEqual(rows, [
    { i: '1', n: 'proj-a', a: true, s: 'running', p: 'proj-a', m: 'build', statusAt: '123' },
    { i: '2', n: 'proj-b', a: false, s: 'idle', p: 'proj-b', m: '' },
  ]);
});

test('normalizeRows suppresses stale or unstamped running status', () => {
  const now = 1_000_000;
  const rows = sidebar.normalizeRows([
    { i: '1', s: 'running', statusAt: String(now - 1000) },
    { i: '2', s: 'running', statusAt: String(now - sidebar.RUNNING_STALE_MS - 1) },
    { i: '3', s: 'running' },
    { i: '4', s: 'failed' },
  ], now);
  assert.equal(rows[0].s, 'running');
  assert.equal(rows[1].s, 'idle');
  assert.equal(rows[2].s, 'idle');
  assert.equal(rows[3].s, 'failed');
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

test('buildSidebarFrame constrains top chrome to one row in narrow sidebars', () => {
  const width = 16;
  const out = sidebar.buildSidebarFrame({
    rows: [{ i: '1', n: 'proj-a', a: true, s: 'idle', p: 'proj-a', m: '' }],
    registry: [],
    discover: [],
    width,
  });

  const lines = out.body.split('\n');
  assert.ok(stripAnsi(lines[0]).length <= width - 1, 'title header must not soft-wrap');
  assert.ok(stripAnsi(lines[1]).length <= width - 1, 'title divider must not soft-wrap');
  assert.match(out.clickmap, /^2\tswitch\t1\t0/m, 'first project row stays fixed below header');
});

test('buildSidebarFrame hard-clips every visual line on very narrow sidebars', () => {
  const width = 10;
  const out = sidebar.buildSidebarFrame({
    rows: [
      { i: '1', n: 'very-long-project-name', a: true, s: 'running', p: 'very-long-project-name', m: '' },
      { i: '2', n: 'another-long-project-name', a: false, s: 'idle', p: 'another-long-project-name', m: '' },
    ],
    registry: [{ name: 'closed-project-with-long-name' }],
    discover: [{ name: 'discover-project-with-long-name' }],
    width,
  });

  for (const line of out.body.split('\n')) {
    assert.ok(stripAnsi(line).length <= width - 1, `line must not wrap: ${JSON.stringify(stripAnsi(line))}`);
  }
  assert.match(out.clickmap, /^2\tswitch\t1\t0/m);
  assert.match(out.clickmap, /^3\tswitch\t2\t0/m);
});

// issue #14: a click in the lower sidebar must activate the row under the
// cursor. The clickmap stores logical row numbers and tmux reports a click's
// *visual* row, so they only stay 1:1 while every rendered line fits the pane
// width. Project names with wide (CJK / emoji) glyphs used to under-count and
// soft-wrap, pushing every clickmap row below the wrap up by one.
test('buildSidebarFrame keeps wide-character rows from wrapping (issue #14)', () => {
  const width = 26;
  // Display width: wide glyphs (CJK / emoji) count as two terminal cells.
  const dispWidth = (s) => {
    let n = 0;
    for (const ch of stripAnsi(s)) {
      const cp = ch.codePointAt(0);
      const wide = (cp >= 0x1100 && cp <= 0x115f) ||
        (cp >= 0x2e80 && cp <= 0xa4cf) ||
        (cp >= 0xac00 && cp <= 0xd7a3) ||
        (cp >= 0xf900 && cp <= 0xfaff) ||
        (cp >= 0xff00 && cp <= 0xff60) ||
        (cp >= 0x1f300 && cp <= 0x1faff);
      n += wide ? 2 : 1;
    }
    return n;
  };
  const out = sidebar.buildSidebarFrame({
    rows: [
      { i: '1', n: '日本語プロジェクト', a: true, s: 'idle', p: '日本語プロジェクト', m: '' },
      { i: '2', n: 'proj-b', a: false, s: 'idle', p: 'proj-b', m: '' },
    ],
    registry: [],
    discover: [],
    width,
  });

  for (const line of out.body.split('\n')) {
    assert.ok(dispWidth(line) <= width - 1,
      `line must not wrap: ${JSON.stringify(stripAnsi(line))} (width ${dispWidth(line)})`);
  }
  // Both project rows stay where the clickmap says they are.
  assert.match(out.clickmap, /^2\tswitch\t1\t0/m);
  assert.match(out.clickmap, /^3\tswitch\t2\t0/m);
});

test('responsiveSidebarWidth follows small/medium/large breakpoints', () => {
  assert.equal(sidebar.responsiveSidebarWidth(60, 26), 16);
  assert.equal(sidebar.responsiveSidebarWidth(90, 26), 20);
  assert.equal(sidebar.responsiveSidebarWidth(140, 26), 26);
  assert.equal(sidebar.responsiveSidebarWidth(140, 18), 18, 'user-configured narrower sidebar stays respected');
});

test('terminalFrame wraps output in synchronized update sequence', () => {
  const out = sidebar.terminalFrame('body');
  assert.ok(out.startsWith('\x1b[?2026h\x1b[2J\x1b[H'));
  assert.ok(out.endsWith('\x1b[?2026l'));
});
