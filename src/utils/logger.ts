/**
 * Central Logger Module
 * Handles debug logging, session tracking, and error serialization.
 * Ensures strict separation between User UI (console) and System Logs (file).
 */
import fs from 'fs';
import path from 'path';

/** Log level type */
type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'ACTION' | 'DEBUG';

/** Log directory path */
const LOG_DIR = path.join(process.cwd(), '.neo');

/** Log file path */
const LOG_FILE = path.join(LOG_DIR, 'debug.log');

// Lazy-load config to avoid circular dependencies
let configCache: { logging: { maxLogSize: number; maxStringLength: number; maxBackups: number } } | null = null;

function getConfig() {
  if (!configCache) {
    // Default values if config not yet loaded
    configCache = {
      logging: {
        maxLogSize: 5 * 1024 * 1024,
        maxStringLength: 1000,
        maxBackups: 3,
      }
    };
    // Try to load actual config
    import('../config.js').then(mod => {
      configCache = mod.config;
    }).catch(() => {
      // Keep defaults if config fails to load
    });
  }
  return configCache;
}

/**
 * Ensures the log directory exists.
 */
function ensureLogDirectory(): boolean {
  try {
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Rotates the log file if it exceeds the maximum size.
 */
function rotateLogIfNeeded(): void {
  try {
    const cfg = getConfig();
    if (fs.existsSync(LOG_FILE)) {
      const stats = fs.statSync(LOG_FILE);
      if (stats.size > cfg.logging.maxLogSize) {
        const backupPath = `${LOG_FILE}.${Date.now()}.old`;
        fs.renameSync(LOG_FILE, backupPath);

        // Clean up old backup files
        const dir = path.dirname(LOG_FILE);
        const backups = fs.readdirSync(dir)
          .filter(f => f.startsWith('debug.log.') && f.endsWith('.old'))
          .sort()
          .reverse();

        for (let i = cfg.logging.maxBackups; i < backups.length; i++) {
          try {
            fs.unlinkSync(path.join(dir, backups[i]));
          } catch {
            // Ignore cleanup errors
          }
        }
      }
    }
  } catch {
    // Ignore rotation errors
  }
}

/**
 * Serializes error objects for logging.
 * @param error - The error to serialize
 * @returns Serialized error object
 */
function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: error.cause
    };
  }
  if (typeof error === 'object' && error !== null) {
    return error as Record<string, unknown>;
  }
  return { value: String(error) };
}

/**
 * Writes a log entry to the file.
 * @param level - Log level
 * @param message - Log message
 * @param data - Optional additional data
 */
function write(level: LogLevel, message: string, data?: unknown): void {
  const timestamp = new Date().toISOString();
  let content = `[${timestamp}] [${level.padEnd(6)}] ${message}`;
  const cfg = getConfig();

  if (data !== undefined) {
    try {
      const seen = new WeakSet();
      const maxLen = cfg.logging.maxStringLength;
      const json = JSON.stringify(data, (key, value) => {
        // Handle circular references
        if (typeof value === 'object' && value !== null) {
          if (seen.has(value)) {
            return '[Circular Reference]';
          }
          seen.add(value);
        }
        // Truncate large strings
        if (typeof value === 'string' && value.length > maxLen) {
          return value.substring(0, maxLen) + `... [${value.length - maxLen} chars truncated]`;
        }
        return value;
      }, 2);
      content += `\nDATA: ${json}`;
    } catch {
      content += `\nDATA: [Unserializable Object]`;
    }
  }

  content += '\n' + '-'.repeat(60) + '\n';

  try {
    if (ensureLogDirectory()) {
      fs.appendFileSync(LOG_FILE, content);
    }
  } catch {
    // If logging fails, do not crash the agent
  }
}

/**
 * Logger interface for the application.
 */
export const logger = {
  /**
   * Initializes a new logging session.
   */
  init(): void {
    try {
      if (!ensureLogDirectory()) return;

      rotateLogIfNeeded();

      const header = [
        '',
        '='.repeat(60),
        `[${new Date().toISOString()}] SESSION START`,
        `Platform: ${process.platform} | Node: ${process.version}`,
        `CWD: ${process.cwd()}`,
        '='.repeat(60),
        ''
      ].join('\n');

      fs.appendFileSync(LOG_FILE, header);
    } catch {
      // Ignore init errors
    }
  },

  /**
   * Logs an info message.
   * @param msg - The message to log
   * @param data - Optional additional data
   */
  info(msg: string, data?: unknown): void {
    write('INFO', msg, data);
  },

  /**
   * Logs a warning message.
   * @param msg - The message to log
   * @param data - Optional additional data
   */
  warn(msg: string, data?: unknown): void {
    write('WARN', msg, data);
  },

  /**
   * Logs an error message.
   * @param msg - The message to log
   * @param error - Optional error object
   */
  error(msg: string, error?: unknown): void {
    const details = error ? serializeError(error) : undefined;
    write('ERROR', msg, details);
  },

  /**
   * Logs a debug message (only in development).
   * @param msg - The message to log
   * @param data - Optional additional data
   */
  debug(msg: string, data?: unknown): void {
    if (process.env.NODE_ENV === 'development' || process.env.DEBUG === 'true') {
      write('DEBUG', msg, data);
    }
  },

  /**
   * Logs a tool action.
   * @param tool - The tool name
   * @param args - The tool arguments
   */
  action(tool: string, args: unknown): void {
    write('ACTION', `Tool: ${tool}`, args);
  }
};