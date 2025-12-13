/**
 * Central Logger Module
 * Handles debug logging, session tracking, and error serialization.
 * Ensures strict separation between User UI (console) and System Logs (file).
 */
import fs from 'fs';
import path from 'path';

/** Log level type */
type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'ACTION' | 'DEBUG';

/** Maximum size for truncated strings in logs */
const MAX_STRING_LENGTH = 1000;

/** Log directory path */
const LOG_DIR = path.join(process.cwd(), '.neo');

/** Log file path */
const LOG_FILE = path.join(LOG_DIR, 'debug.log');

/** Maximum log file size before rotation (5MB) */
const MAX_LOG_SIZE = 5 * 1024 * 1024;

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
    if (fs.existsSync(LOG_FILE)) {
      const stats = fs.statSync(LOG_FILE);
      if (stats.size > MAX_LOG_SIZE) {
        const backupPath = `${LOG_FILE}.${Date.now()}.old`;
        fs.renameSync(LOG_FILE, backupPath);

        // Clean up old backup files (keep only last 3)
        const dir = path.dirname(LOG_FILE);
        const backups = fs.readdirSync(dir)
          .filter(f => f.startsWith('debug.log.') && f.endsWith('.old'))
          .sort()
          .reverse();

        for (let i = 3; i < backups.length; i++) {
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

  if (data !== undefined) {
    try {
      const seen = new WeakSet();
      const json = JSON.stringify(data, (key, value) => {
        // Handle circular references
        if (typeof value === 'object' && value !== null) {
          if (seen.has(value)) {
            return '[Circular Reference]';
          }
          seen.add(value);
        }
        // Truncate large strings
        if (typeof value === 'string' && value.length > MAX_STRING_LENGTH) {
          return value.substring(0, MAX_STRING_LENGTH) + `... [${value.length - MAX_STRING_LENGTH} chars truncated]`;
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