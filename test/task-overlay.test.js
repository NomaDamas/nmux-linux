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

test('16:9 monitors stay 3-column (no sub pane); only ultrawide gets one', () => {
  // A normal 16:9 monitor is ~3.4-3.5:1 in terminal cells even at high
  // resolution where it spans many columns. It must NOT get a sub pane.
  assert.equal(overlay.isWideAspect(179, 52), false);   // 3.44:1, 16:9
  assert.equal(overlay.isWideAspect(240, 67), false);   // 3.58:1, high-res 16:9
  const wide169 = overlay.computeResponsiveLayout(179, 52, 26, { hasRight: true, wantSub: true });
  assert.equal(wide169.subWidth, 0, '16:9 must stay 3-column');
  assert.notEqual(wide169.mode, 'wide');

  // Genuine ultrawide (>=4.0) earns the extra far-right pane.
  assert.equal(overlay.isWideAspect(260, 45), true);    // 5.78:1, 21:9
  const ultra = overlay.computeResponsiveLayout(260, 45, 26, { hasRight: true, wantSub: true });
  assert.equal(ultra.mode, 'wide');
  assert.ok(ultra.subWidth >= 40, `expected an extra pane, got subWidth=${ultra.subWidth}`);
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

test('agent prompt detection treats idle input box as not running', () => {
  const pane = `
 gajae
 작업 완료.

┌─────────────────────────────────────────────────────────────┐
│ > Type your message...                                      │
└─────────────────────────────────────────────────────────────┘`;
  assert.equal(overlay.paneTextLooksAwaitingInput(pane), true);
});

test('agent prompt detection ignores stale prompt while work is active', () => {
  const pane = `
┌─────────────────────────────────────────────────────────────┐
│ > Type your message...                                      │
└─────────────────────────────────────────────────────────────┘

• Working (4m 27s • esc to interrupt)`;
  assert.equal(overlay.paneTextLooksAwaitingInput(pane), false);
});

test('agent prompt detection ignores prompt while a tool is running', () => {
  const pane = `
┌─────────────────────────────────────────────────────────────┐
│ > Type your message...                                      │
└─────────────────────────────────────────────────────────────┘

 ⠇ Read ModuDoc tree ⟦esc⟧`;
  assert.equal(overlay.paneTextLooksAwaitingInput(pane), false);
});

test('agent activity state treats GJC background jobs marker as busy', () => {
  const pane = `
 ✔ Todo Write 9 tasks
 ⬢ gpt-5.5 via Nomadamas proxy · ◒ med / 📁 ~/projects/private ─ ⚠ jobs / ⤴ 22.4/s

┌─────────────────────────────────────────────────────────────┐
│ > Type your message...                                      │
└─────────────────────────────────────────────────────────────┘`;
  assert.equal(overlay.paneTextActivityState(pane), 'busy');
  assert.equal(overlay.paneTextLooksAwaitingInput(pane), false);
});

test('agent activity state treats pending spinner command as busy', () => {
  const pane = `
 ┌─── ⏳ Bash ─────────────────────────────────────────────────┐
 │ $ long running benchmark                                    │
 └─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ > Type your message...                                      │
└─────────────────────────────────────────────────────────────┘`;
  assert.equal(overlay.paneTextActivityState(pane), 'busy');
});

test('agent activity state ignores stale timed-out command transcript', () => {
  const pane = `
 gajae
 완료했습니다.

 ⏳ Bash: $ old command from previous transcript

┌─────────────────────────────────────────────────────────────┐
│ > Type your message...                                      │
└─────────────────────────────────────────────────────────────┘`;
  assert.equal(overlay.paneTextActivityState(pane), 'idle');
});

test('hidden live agent process keeps unknown screen busy', () => {
  assert.equal(overlay.activityStateFromSignals('unknown', true), 'busy');
  assert.equal(overlay.activityStateFromSignals('unknown', false), 'unknown');
});

test('visible idle prompt overrides live agent process', () => {
  assert.equal(overlay.activityStateFromSignals('idle', true), 'idle');
});

test('window visit keeps running while GJC work is still busy', () => {
  assert.equal(overlay.statusAfterVisit('done', 'busy'), 'running');
  assert.equal(overlay.statusAfterVisit('idle', 'busy'), 'running');
  assert.equal(overlay.statusAfterVisit('running', 'idle'), 'idle');
});

test('window visit clears only settled non-running indicators', () => {
  assert.equal(overlay.statusAfterVisit('done', 'idle'), 'idle');
  assert.equal(overlay.statusAfterVisit('failed', 'idle'), 'idle');
  assert.equal(overlay.statusAfterVisit('need-input', 'idle'), 'idle');
});

test('status rowmap survives separate click handler process lookup', () => {
  const paneId = `%test-${process.pid}`;
  const rowMap = new Map([[7, 'clicked command'], [8, 'next command']]);
  overlay.writeTaskRowmap(paneId, rowMap, 48, 24);
  assert.equal(overlay.readTaskClickSubject(paneId, 7), 'clicked command');
  assert.equal(overlay.readTaskClickSubject(paneId, 9), '');
});

test('searchableSubjectsFromText marks only commands still in main transcript', () => {
  const subjects = ['recent command to jump', 'old command lost from context'];
  const ok = overlay.searchableSubjectsFromText(subjects, 'assistant output recent command to jump done');
  assert.equal(ok.has('recent command to jump'), true);
  assert.equal(ok.has('old command lost from context'), false);
});

test('taskSearchSnippet uses normalized leading search text', () => {
  assert.equal(overlay.taskSearchSnippet('  abc   def  '.repeat(5)), 'abc def abc def abc def abc def abc def');
});

test('project display helpers keep cwd stable while showing friendly label and folder', () => {
  const project = { name: 'stable_key', displayName: 'Friendly Name', cwd: '/tmp/actual-folder' };
  assert.equal(overlay.projectDisplayName(project), 'Friendly Name');
  assert.equal(overlay.projectFolderName(project), 'actual-folder');
  assert.equal(overlay.projectDisplayTitle(project), 'Friendly Name · actual-folder');
});

test('findProjectByKey resolves stable name, display label, and cwd', () => {
  const cfg = { projects: [{ name: 'stable_key', displayName: 'Friendly Name', cwd: '/tmp/actual-folder' }] };
  assert.equal(overlay.findProjectByKey(cfg, 'stable_key').name, 'stable_key');
  assert.equal(overlay.findProjectByKey(cfg, 'Friendly Name').name, 'stable_key');
  assert.equal(overlay.findProjectByKey(cfg, '/tmp/actual-folder').name, 'stable_key');
});
