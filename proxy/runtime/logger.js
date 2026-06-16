// MODULAR: Structured logger. One shape: {"ts":..., "level":..., "msg":..., ...fields}.
// DRY: every log line goes through here; no console.log/warn/error
// outside this module.
//
// ORGANIZED: lives in runtime/ alongside the other cross-cutting
// concerns (config, http, validation). The export is a single
// object with level methods; consumers call log.info("msg", fields).

'use strict';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const CURRENT_LEVEL = LEVELS[process.env.LOG_LEVEL || 'info'] || LEVELS.info;

function ts() {
  return new Date().toISOString();
}

function emit(level, msg, fields) {
  if (LEVELS[level] < CURRENT_LEVEL) return;
  const line = JSON.stringify({ ts: ts(), level, msg, ...(fields || {}) }) + '\n';
  // MODULAR: write to stdout for info/debug, stderr for warn/error.
  // Railway / Fly / Heroku all parse stdout JSON natively.
  const stream = (level === 'warn' || level === 'error') ? process.stderr : process.stdout;
  stream.write(line);
}

const log = {
  debug: (msg, fields) => emit('debug', msg, fields),
  info:  (msg, fields) => emit('info',  msg, fields),
  warn:  (msg, fields) => emit('warn',  msg, fields),
  error: (msg, fields) => emit('error', msg, fields)
};

// CLEAN: a 1-line bootstrap line. The proxy prints a "listening"
// line on boot; everything else is a structured log call.
log.info('logger initialised', { level: process.env.LOG_LEVEL || 'info' });

module.exports = { log };
