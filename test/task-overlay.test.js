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
