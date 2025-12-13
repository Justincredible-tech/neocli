// src/config.ts
/**
 * Central configuration for NeoCLI.
 * All magic numbers and configurable values are defined here.
 */

import { config as dotenvConfig } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: path.join(__dirname, '../.env') });

/**
 * Parses an environment variable as an integer with a default value.
 */
function envInt(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (value === undefined) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Parses an environment variable as a boolean with a default value.
 */
function envBool(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === 'true' || value === '1';
}

/**
 * Application configuration object.
 * Values can be overridden via environment variables.
 */
export const config = {
  /** Application metadata */
  app: {
    name: 'NeoCLI',
    version: '2.3.0',
  },

  /** Ollama LLM configuration */
  llm: {
    /** Ollama API host URL */
    host: process.env.OLLAMA_HOST || 'http://127.0.0.1:11434',
    /** Default model to use for generation */
    defaultModel: process.env.DEFAULT_MODEL || 'qwen3-coder:30b',
    /** Model to use for embeddings */
    embeddingModel: process.env.EMBEDDING_MODEL || 'nomic-embed-text',
    /** Context window size in tokens */
    contextWindowSize: envInt('CONTEXT_WINDOW_SIZE', 32768),
    /** Temperature for generation (0-1) */
    temperature: 0.3,
    /** Maximum retries for API calls */
    maxRetries: 3,
    /** Timeout for API calls in milliseconds (5 minutes default for complex operations) */
    timeoutMs: envInt('LLM_TIMEOUT_MS', 300000),
    /** Stop sequences */
    stopSequences: ['<USER_INPUT>', '</ROLE>'] as string[],
  },

  /** Agent configuration */
  agent: {
    /** Maximum steps per agent run */
    maxSteps: envInt('MAX_AGENT_STEPS', 30),
    /** Maximum output length before truncation */
    maxOutputLength: envInt('MAX_OUTPUT_LENGTH', 3500),
    /** Number of recent actions to track for loop detection */
    actionHistorySize: 20,
    /** Number of loop occurrences before intervention */
    loopThreshold: 3,
    /** Maximum chat history entries to retain */
    maxChatHistoryEntries: envInt('MAX_CHAT_HISTORY', 60),
    /** Whether to require approval for high-risk actions */
    requireApproval: envBool('REQUIRE_APPROVAL', true),
  },

  /** File system configuration */
  filesystem: {
    /** Maximum file size to read in bytes (10MB) */
    maxFileSize: envInt('MAX_FILE_SIZE', 10 * 1024 * 1024),
    /** Maximum directory depth for tree walking */
    maxDirectoryDepth: 4,
    /** Directories to ignore when scanning */
    ignoredDirectories: ['.git', 'node_modules', 'dist', 'build', 'coverage', '__pycache__'] as string[],
    /** File extensions to include in code scanning */
    codeExtensions: ['.ts', '.js', '.tsx', '.jsx', '.py', '.java', '.go', '.rs', '.c', '.cpp', '.h'],
  },

  /** Search/grep configuration */
  search: {
    /** Maximum number of files to search */
    maxFiles: 500,
    /** Maximum number of search results */
    maxResults: 50,
    /** Maximum file size to search (1MB) */
    maxFileSize: 1024 * 1024,
    /** Maximum regex pattern length */
    maxPatternLength: 500,
  },

  /** Memory configuration */
  memory: {
    /** Similarity threshold for memory search (0-1) */
    similarityThreshold: 0.4,
    /** Maximum number of memory search results */
    maxSearchResults: 5,
  },

  /** Security configuration */
  security: {
    /** Maximum SQL query length */
    maxQueryLength: 10000,
    /** Maximum commit message length */
    maxCommitMessageLength: 500,
    /** Maximum URL length */
    maxUrlLength: 2048,
  },

  /** UI configuration */
  ui: {
    /** Spinner animation frames */
    spinnerFrames: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
    /** Spinner update interval in milliseconds */
    spinnerIntervalMs: 80,
    /** Maximum argument display length */
    maxArgDisplayLength: 70,
    /** Maximum output display length */
    maxOutputDisplayLength: 300,
    /** Box width for UI elements */
    boxWidth: 80,
    /** Dynamic status messages for thinking state (Matrix theme) */
    thinkingMessages: [
      'Reading the code...',
      'Following the white rabbit...',
      'Tracing the signal...',
      'There is no spoon...',
      'Seeing the Matrix...',
      'Bending the rules...',
      'Finding the path...',
      'Decrypting the stream...',
      'Jacking in...',
      'Loading construct...',
    ] as string[],
  },

  /** Paths configuration */
  paths: {
    /** Root directory for .neo storage */
    neoDir: path.join(process.cwd(), '.neo'),
    /** Skills directory */
    skillsDir: path.join(process.cwd(), '.neo', 'skills'),
    /** Memory directory */
    memoryDir: path.join(process.cwd(), '.neo', 'memory'),
    /** Long-term memory file */
    ltmFile: path.join(process.cwd(), '.neo', 'memory', 'ltm_store.json'),
    /** Chat history file */
    chatHistoryFile: path.join(process.cwd(), '.neo', 'memory.json'),
    /** Debug log file */
    debugLogFile: path.join(process.cwd(), '.neo', 'debug.log'),
    /** MCP configuration file */
    mcpConfigFile: path.join(process.cwd(), '.neo', 'mcp_config.json'),
    /** SQLite database file */
    sqliteDbFile: path.join(process.cwd(), '.neo', 'neodb.sqlite'),
  },

  /** Skill scanner configuration */
  scanner: {
    /** Maximum file size to scan in KB */
    maxFileSizeKb: 100,
    /** Extensions to scan */
    scanExtensions: ['.ts', '.js', '.py', '.tsx', '.jsx'],
  },
} as const;

/** Type for the configuration object */
export type Config = typeof config;

export default config;
