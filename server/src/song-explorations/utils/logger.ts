const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type Level = keyof typeof LEVELS;

let currentLevel: Level = 'info';

export function setLogLevel(level: Level) {
  currentLevel = level;
}

function shouldLog(level: Level): boolean {
  return LEVELS[level] >= LEVELS[currentLevel];
}

function ts(): string {
  return new Date().toISOString();
}

export const log = {
  debug: (...args: unknown[]) => shouldLog('debug') && console.log(`[${ts()}] DEBUG`, ...args),
  info: (...args: unknown[]) => shouldLog('info') && console.log(`[${ts()}] INFO `, ...args),
  warn: (...args: unknown[]) => shouldLog('warn') && console.warn(`[${ts()}] WARN `, ...args),
  error: (...args: unknown[]) => shouldLog('error') && console.error(`[${ts()}] ERROR`, ...args),
};
