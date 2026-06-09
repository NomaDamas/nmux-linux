const test = require('node:test');
const assert = require('node:assert/strict');

const overlay = require('../bin/nmux-linux');

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

test('responsive layout collapses an existing sub pane instead of killing small-screen usability', () => {
  const p = overlay.computeResponsiveLayout(92, 28, 26, { hasRight: true, hasSub: true });
  assert.equal(p.sidebarWidth, 20);
  assert.ok(p.subWidth <= 12);
  assert.ok(p.mainWidth >= 36);
});
