#!/usr/bin/env node
// install-claude-hooks.js — wire nmux-linux notify-current as Claude Code
// Stop / SubagentStop / Notification / UserPromptSubmit hooks.
//
// PreToolUse is intentionally NOT installed by default — it would re-fire
// the running indicator (and the desktop toast / sound) once per tool
// call, which is alert-fatigue territory. Add it manually if you want it.
//
// Idempotent: a hook command containing "nmux-linux notify-current" is
// detected and left alone (we don't append duplicates).

const fs = require('fs');

const settingsPath = process.argv[2] || (process.env.HOME + '/.claude/settings.json');
const NMUX = process.env.NMUX_BIN_PATH || (process.env.HOME + '/.local/bin/nmux-linux');

if (!fs.existsSync(settingsPath)) {
  console.error(`settings.json not found: ${settingsPath}`);
  process.exit(0);
}

// Shell-quote the path so a binary path with spaces / shell metas
// can't break the hook command string.
function shQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}
const NMUX_Q = shQuote(NMUX);

const raw = fs.readFileSync(settingsPath, 'utf8');
let cfg;
try { cfg = JSON.parse(raw); } catch (e) {
  console.error(`settings.json parse error: ${e.message}; aborting hook install`);
  process.exit(1);
}

cfg.hooks = cfg.hooks || {};

const HOOK_DEFS = [
  { event: 'UserPromptSubmit', status: 'running',    msg: 'in progress' },
  { event: 'Notification',     status: 'need-input', msg: 'agent awaiting input' },
  { event: 'SubagentStop',     status: 'done',       msg: 'subagent finished' },
  { event: 'Stop',             status: 'done',       msg: 'agent finished' },
];

function existing(events, fragment) {
  if (!Array.isArray(events)) return false;
  for (const group of events) {
    if (!group || !Array.isArray(group.hooks)) continue;
    for (const hook of group.hooks) {
      if (hook && typeof hook.command === 'string' && hook.command.includes(fragment)) return true;
    }
  }
  return false;
}

for (const def of HOOK_DEFS) {
  const cmd = `${NMUX_Q} notify-current --status ${def.status} --message ${shQuote(def.msg)} >/dev/null 2>&1 || true`;
  cfg.hooks[def.event] = cfg.hooks[def.event] || [];
  if (existing(cfg.hooks[def.event], 'nmux-linux notify-current')) continue;
  cfg.hooks[def.event].push({ hooks: [{ type: 'command', command: cmd }] });
}

const tmp = settingsPath + '.tmp.' + process.pid;
fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + '\n');
fs.renameSync(tmp, settingsPath);
console.log(`[install-claude-hooks] updated ${settingsPath}`);
