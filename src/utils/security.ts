// src/utils/security.ts
import * as path from 'path';

/**
 * SecurityGuard - Central security validation for all file and command operations.
 * Implements defense-in-depth with multiple validation layers.
 */
export class SecurityGuard {
  /** Blocked filenames that should never be accessed */
  private static readonly BLOCKED_FILES = new Set([
    '.env', '.env.local', '.env.production', '.env.development',
    'id_rsa', 'id_rsa.pub', 'id_ed25519', 'id_ed25519.pub', 'id_dsa',
    '.bash_history', '.zsh_history', '.node_repl_history',
    'passwd', 'shadow', 'sudoers',
    '.npmrc', '.pypirc', 'credentials', 'credentials.json',
    '.netrc', '.pgpass', '.my.cnf'
  ]);

  /** Blocked directory names that should never be traversed */
  private static readonly BLOCKED_DIRS = new Set(['.git', '.ssh', '.gnupg', '.aws', '.azure', '.kube']);

  /** Dangerous command patterns */
  private static readonly BLOCKED_COMMANDS = [
    'rm -rf /',
    'rm -rf ~',
    'rm -rf *',
    'sudo',
    ':(){ :|:& };:',  // Fork bomb
    '> /dev/sd',
    'mv /',
    'mkfs',
    'dd if=',
    'chmod -R 777',
    'curl | sh',
    'curl | bash',
    'wget | sh',
    'wget | bash',
    '> /dev/null 2>&1 &',  // Background execution hiding
    'eval ',
    '$(', '`'  // Command substitution (potential injection)
  ];

  /** Maximum allowed regex pattern length to prevent ReDoS */
  private static readonly MAX_REGEX_LENGTH = 500;

  /** Characters that could enable shell injection */
  private static readonly SHELL_METACHARACTERS = /[;&|`$(){}[\]<>\\!#*?~]/;

  /**
   * Validates and sanitizes a file path.
   * @param targetPath - The path to validate
   * @returns The resolved, validated path
   * @throws Error if path is invalid or blocked
   */
  static validatePath(targetPath: string): string {
    if (!targetPath || typeof targetPath !== 'string') {
      throw new Error("SECURITY BLOCK: Invalid path - must be a non-empty string.");
    }

    // Normalize and remove null bytes (poison null byte attack)
    const cleanPath = targetPath.replace(/\0/g, '');

    const root = process.cwd();
    const neoDir = path.join(root, '.neo');

    // Resolve to absolute path
    const resolved = path.resolve(root, cleanPath);

    // 1. Allow .neo directory (Internal Memory) - but validate it's actually under root
    if (resolved.startsWith(neoDir + path.sep) || resolved === neoDir) {
      return resolved;
    }

    // 2. Prevent Path Traversal (must start with root)
    if (!resolved.startsWith(root + path.sep) && resolved !== root) {
      throw new Error(`SECURITY BLOCK: Path traversal detected. Access to '${targetPath}' denied.`);
    }

    // 3. Check for blocked directories in path
    const pathParts = resolved.split(path.sep);
    for (const part of pathParts) {
      if (this.BLOCKED_DIRS.has(part)) {
        throw new Error(`SECURITY BLOCK: Access to protected directory '${part}' is prohibited.`);
      }
    }

    // 4. Sensitive File Blocking
    const filename = path.basename(resolved).toLowerCase();
    if (this.BLOCKED_FILES.has(filename)) {
      throw new Error(`SECURITY BLOCK: Access to sensitive file '${filename}' is strictly prohibited.`);
    }

    return resolved;
  }

  /**
   * Validates a shell command for dangerous patterns.
   * @param command - The command to validate
   * @throws Error if command contains dangerous patterns
   */
  static validateCommand(command: string): void {
    if (!command || typeof command !== 'string') {
      throw new Error("SECURITY BLOCK: Invalid command.");
    }

    const lowerCommand = command.toLowerCase();

    for (const blocked of this.BLOCKED_COMMANDS) {
      if (lowerCommand.includes(blocked.toLowerCase())) {
        throw new Error(`SECURITY BLOCK: Dangerous command pattern '${blocked}' detected.`);
      }
    }
  }

  /**
   * Sanitizes a string for safe use in shell commands.
   * @param input - The input to sanitize
   * @returns Sanitized string safe for shell use
   */
  static sanitizeShellArg(input: string): string {
    if (!input || typeof input !== 'string') {
      return '';
    }

    // Escape or remove shell metacharacters
    // Using single quotes and escaping internal single quotes
    const escaped = input.replace(/'/g, "'\\''");
    return `'${escaped}'`;
  }

  /**
   * Checks if a string contains shell metacharacters.
   * @param input - The input to check
   * @returns True if metacharacters are present
   */
  static hasShellMetacharacters(input: string): boolean {
    return this.SHELL_METACHARACTERS.test(input);
  }

  /**
   * Validates a regex pattern for safety (prevents ReDoS).
   * @param pattern - The regex pattern to validate
   * @returns True if pattern is safe
   * @throws Error if pattern is dangerous
   */
  static validateRegexPattern(pattern: string): boolean {
    if (!pattern || typeof pattern !== 'string') {
      throw new Error("SECURITY BLOCK: Invalid regex pattern.");
    }

    // Check length
    if (pattern.length > this.MAX_REGEX_LENGTH) {
      throw new Error(`SECURITY BLOCK: Regex pattern too long (max ${this.MAX_REGEX_LENGTH} chars).`);
    }

    // Check for potentially catastrophic backtracking patterns
    // These patterns can cause exponential time complexity
    const dangerousPatterns = [
      /\(\.\*\)\+/,           // (.*)+
      /\(\.\+\)\+/,           // (.+)+
      /\(\[.*\]\+\)\+/,       // ([...]+)+
      /\(\.\*\)\*\.\*/,       // (.*)*.*
      /\(\.\+\?\)\+/,         // (.+?)+
      /\(\.\{.*,.*\}\)\+/,    // (.{n,m})+
    ];

    for (const dangerous of dangerousPatterns) {
      if (dangerous.test(pattern)) {
        throw new Error("SECURITY BLOCK: Regex pattern contains potentially dangerous backtracking.");
      }
    }

    // Try to compile the regex to check for syntax errors
    try {
      new RegExp(pattern);
      return true;
    } catch (e) {
      throw new Error(`SECURITY BLOCK: Invalid regex syntax - ${(e as Error).message}`);
    }
  }

  /**
   * Validates SQL query for dangerous patterns.
   * @param query - The SQL query to validate
   * @param allowedOperations - List of allowed SQL operations
   * @throws Error if query contains dangerous patterns
   */
  static validateSqlQuery(query: string, allowedOperations: string[] = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'ALTER']): void {
    if (!query || typeof query !== 'string') {
      throw new Error("SECURITY BLOCK: Invalid SQL query.");
    }

    const upperQuery = query.trim().toUpperCase();

    // Check if query starts with an allowed operation
    const startsWithAllowed = allowedOperations.some(op => upperQuery.startsWith(op));
    if (!startsWithAllowed) {
      throw new Error(`SECURITY BLOCK: SQL operation not allowed. Permitted: ${allowedOperations.join(', ')}`);
    }

    // Block dangerous SQL patterns
    const dangerousPatterns = [
      /;\s*(DROP|DELETE|TRUNCATE|ALTER|EXEC|EXECUTE)\s/i,  // Chained dangerous commands
      /--/,                    // SQL comments (can hide malicious code)
      /\/\*/,                  // Block comments
      /UNION\s+SELECT/i,       // Union injection
      /INTO\s+OUTFILE/i,       // File write
      /LOAD_FILE/i,            // File read
      /BENCHMARK\s*\(/i,       // Timing attacks
      /SLEEP\s*\(/i,           // Time-based injection
    ];

    for (const dangerous of dangerousPatterns) {
      if (dangerous.test(query)) {
        throw new Error("SECURITY BLOCK: SQL query contains potentially dangerous pattern.");
      }
    }
  }

  /**
   * Determines if a tool/action combination is high-risk and requires approval.
   * @param tool - The tool name
   * @param args - The tool arguments
   * @returns True if the action is high-risk
   */
  static isHighRisk(tool: string, args: unknown): boolean {
    const riskyTools = new Set([
      'write_file',
      'execute_command',
      'create_skill',
      'git_automator',
      'sqlite_manager',
      'webhook_server',
      'api_client'
    ]);

    if (riskyTools.has(tool)) return true;

    // Delete operations are always risky
    if (tool === 'execute_fs') {
      try {
        const argsStr = JSON.stringify(args);
        if (argsStr.includes('delete') || argsStr.includes('remove')) {
          return true;
        }
      } catch {
        // If we can't serialize, err on the side of caution
        return true;
      }
    }

    return false;
  }

  /**
   * Validates a URL for safety.
   * @param url - The URL to validate
   * @returns True if URL is safe
   * @throws Error if URL is dangerous
   */
  static validateUrl(url: string): boolean {
    if (!url || typeof url !== 'string') {
      throw new Error("SECURITY BLOCK: Invalid URL.");
    }

    try {
      const parsed = new URL(url);

      // Only allow http and https
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error(`SECURITY BLOCK: Protocol '${parsed.protocol}' not allowed. Use http or https.`);
      }

      // Block localhost and internal IPs (SSRF prevention)
      const hostname = parsed.hostname.toLowerCase();
      const blockedHosts = ['localhost', '127.0.0.1', '0.0.0.0', '::1'];
      const internalRanges = [
        /^10\./,
        /^172\.(1[6-9]|2[0-9]|3[01])\./,
        /^192\.168\./,
        /^169\.254\./,
      ];

      if (blockedHosts.includes(hostname)) {
        throw new Error("SECURITY BLOCK: Access to localhost is not allowed.");
      }

      for (const range of internalRanges) {
        if (range.test(hostname)) {
          throw new Error("SECURITY BLOCK: Access to internal IP ranges is not allowed.");
        }
      }

      return true;
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('SECURITY BLOCK:')) {
        throw e;
      }
      throw new Error(`SECURITY BLOCK: Invalid URL format - ${(e as Error).message}`);
    }
  }
}