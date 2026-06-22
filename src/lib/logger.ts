// MODULAR: Structured logger. One shape: {"ts":..., "level":..., "msg":..., ...fields}.
// DRY: every log line goes through here; no console.log/warn/error
//      outside this module. Edge runtime safe: writes to stdout/stderr
//      via .write() which is available in both Node and Edge runtimes.

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const CURRENT_LEVEL: number =
  LEVELS[(process.env.LOG_LEVEL as LogLevel) || 'info'] || LEVELS.info;

function ts(): string {
  return new Date().toISOString();
}

function emit(level: LogLevel, msg: string, fields?: Record<string, unknown>): void {
  if (LEVELS[level] < CURRENT_LEVEL) return;
  const line =
    JSON.stringify({ ts: ts(), level, msg, ...(fields || {}) }) + '\n';
  // MODULAR: write to stdout for info/debug, stderr for warn/error.
  const stream =
    level === 'warn' || level === 'error' ? process.stderr : process.stdout;
  stream.write(line);
}

export const log = {
  debug: (msg: string, fields?: Record<string, unknown>) => emit('debug', msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => emit('info', msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit('warn', msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit('error', msg, fields),
};

// CLEAN: a 1-line bootstrap line. The proxy prints a "ready" line on
// boot; everything else is a structured log call.
log.info('logger initialised', { level: process.env.LOG_LEVEL || 'info' });
