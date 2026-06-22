const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const overlay = require('../bin/nmux-linux');

test('parseGjcUserMessages extracts only user-typed messages, trimmed and ordered', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gjc-test-'));
  const fp = path.join(dir, 'session.jsonl');
  const recs = [
    { type: 'session', version: 3 },
    { type: 'message', message: { role: 'user', attribution: 'user', content: [{ type: 'text', text: '첫 명령' }] } },
    { type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: '답변' }] } },
    { type: 'message', message: { role: 'user', attribution: 'user', content: [{ type: 'text', text: '  둘째   명령  ' }] } },
    { type: 'message', message: { role: 'user', attribution: 'toolResult', content: [{ type: 'text', text: '도구 결과' }] } },
    { type: 'message', message: { role: 'user', attribution: 'user', content: [{ type: 'text', text: '<system-reminder>무시</system-reminder>' }] } },
  ];
  fs.writeFileSync(fp, recs.map(r => JSON.stringify(r)).join('\n') + '\n');
  const msgs = overlay.parseGjcUserMessages(fp, fs.statSync(fp));
  assert.deepEqual(msgs.map(m => m.subject), ['첫 명령', '둘째 명령']);
  assert.deepEqual(msgs.map(m => m.order), [0, 1]);
  assert.ok(msgs.every(m => m.status === 'message'));
});

test('clipToCells truncates by terminal display width, not code-unit length', () => {
  // 10 Korean syllables = 20 cells. Fits within 24, must not be clipped.
  assert.equal(overlay.clipToCells('가나다라마바사아자차', 24), '가나다라마바사아자차');
  // Clipped result must never exceed the cell budget (wide chars + …).
  const clipped = overlay.clipToCells('가나다라마바사아자차카타파하', 12);
  const cells = [...clipped].reduce((n, ch) => {
    const cp = ch.codePointAt(0);
    return n + ((cp >= 0xac00 && cp <= 0xd7a3) ? 2 : 1);
  }, 0);
  assert.ok(cells <= 12, `clipped width ${cells} must be <= 12`);
  assert.ok(clipped.endsWith('…'));
});

test('no-task overlay fallback shows Korean status dashboard', () => {
  const ctx = {
    project: 'sample-b',
    status: 'idle',
    message: '',
    mainCommand: 'bash',
    mainCwd: '/tmp/sample-b',
    agent: '',
  };
  const lines = overlay.renderTaskOverlaySummaryLines(ctx, '(no source)', 50)
    .concat(overlay.renderNoTaskFallbackLines(ctx, '(no source)', 50));
  const body = lines.join('\n');
  assert.match(body, /상태판/);
  assert.match(body, /대기\(idle\)/);
  assert.match(body, /작업 목록/);
  assert.match(body, /없음/);
  assert.match(body, /TODO\.md \/ Claude \/ Codex \/ omx 작업 파일 없음/);
});

test('overlay text clipping is deterministic', () => {
  assert.equal(overlay.clipDisplayText('abcdef', 4), 'abc…');
  assert.equal(overlay.clipDisplayText('abc', 4), 'abc');
});

test('responsive layout uses compact stable widths on small screens', () => {
  const p = overlay.computeResponsiveLayout(80, 24, 26, { hasRight: true, wantSub: true });
  assert.equal(p.mode, 'small');
  assert.equal(p.sidebarWidth, 20);
  assert.equal(p.subWidth, 0);
  assert.ok(p.mainWidth >= 36);
  assert.ok(p.rightWidth >= 16);
});

test('responsive layout keeps full auxiliary column on wide screens', () => {
  const p = overlay.computeResponsiveLayout(260, 45, 26, { hasRight: true, wantSub: true });
  assert.equal(p.mode, 'wide');
  assert.equal(p.sidebarWidth, 26);
  assert.ok(p.subWidth >= 40);
  assert.ok(p.mainWidth > p.subWidth);
  assert.ok(p.rightWidth >= 24);
});

test('wide-but-not-ultrawide monitor gets an extra far-right pane instead of over-wide main', () => {
  // 179x52 (~3.44:1) is a normal wide monitor, not ultrawide. The old
  // aspect-only gate (>=4.0) left main stretched to ~122 cells with no
  // auxiliary pane. It must now qualify for the sub pane.
  assert.equal(overlay.isWideAspect(179, 52), true);
  const p = overlay.computeResponsiveLayout(179, 52, 26, { hasRight: true, wantSub: true });
  assert.equal(p.mode, 'wide');
  assert.ok(p.subWidth >= 40, `expected an extra pane, got subWidth=${p.subWidth}`);
  assert.ok(p.mainWidth >= 50, 'main pane keeps its minimum width');
  // small / short clients must still stay 3-column (room gate).
  assert.equal(overlay.isWideAspect(110, 30), false);
  const small = overlay.computeResponsiveLayout(92, 28, 26, { hasRight: true, wantSub: true });
  assert.ok(small.subWidth <= 12);
});

test('responsive layout collapses an existing sub pane instead of killing small-screen usability', () => {
  const p = overlay.computeResponsiveLayout(92, 28, 26, { hasRight: true, hasSub: true });
  assert.equal(p.sidebarWidth, 20);
  assert.ok(p.subWidth <= 12);
  assert.ok(p.mainWidth >= 36);
});

test('sanitizeTitle drops kitty-graphics APC blobs that leak into pane_title', () => {
  // Bare kitty-graphics payload (issue #7): collapses to empty so it can't
  // be mis-routed or echoed back as a wall of garbage.
  assert.equal(overlay.sanitizeTitle('Gm=0;CCGEEMKQNieEEEAAAA=='), '');
  assert.equal(overlay.sanitizeTitle('Ga=T,f=100,s=10;iVBORw0KGgo='), '');
  // Wrapped APC escape sequence is stripped entirely.
  assert.equal(overlay.sanitizeTitle('\x1b_Gm=0;AAAA\x1b\\'), '');
  // Raw control bytes are removed.
  assert.equal(overlay.sanitizeTitle('foo\x07\x1b[31mbar'), 'foobar');
  // Legitimate titles are preserved untouched.
  assert.equal(overlay.sanitizeTitle('nmux-linux-sidebar'), 'nmux-linux-sidebar');
  assert.equal(overlay.sanitizeTitle('myproject-status'), 'myproject-status');
  assert.equal(overlay.sanitizeTitle(''), '');
});

test('graphics-blob title resolves to main pane, not a reserved role', () => {
  const garbage = overlay.sanitizeTitle('Gm=0;x2XSXhJCCCGEEDK');
  // Empty after sanitizing → paneRoleOf returns null → treated as the main pane.
  assert.equal(overlay.paneRoleOf(garbage), null);
  // Trusted titles still route correctly.
  assert.equal(overlay.paneRoleOf('nmux-linux-sidebar'), 'sidebar');
  assert.equal(overlay.paneRoleOf('proj-status'), 'status');
});
