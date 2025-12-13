/* NEO_SKILL_META
{
  "name": "git_automator",
  "description": "Runs git commands to save state. Supports status, save, diff, log, and branch operations.",
  "argsSchema": {
    "type": "object",
    "properties": {
      "action": { "type": "string", "enum": ["status", "save", "diff", "log", "branch"], "description": "Git operation to perform" },
      "message": { "type": "string", "description": "Commit message (required for 'save')" },
      "count": { "type": "number", "description": "Number of log entries to show (default: 5)" }
    },
    "required": ["action"]
  }
}
NEO_SKILL_META */

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/** Maximum allowed commit message length */
const MAX_MESSAGE_LENGTH = 500;

/** Allowed characters in commit messages (prevents shell injection) */
const SAFE_MESSAGE_PATTERN = /^[\w\s.,!?;:'"()\-\[\]{}@#$%^&*+=/<>|~`]+$/;

/**
 * Validates and sanitizes a commit message.
 * @param message - The commit message to validate
 * @returns Sanitized message
 * @throws Error if message is invalid
 */
function validateCommitMessage(message: string): string {
  if (!message || typeof message !== 'string') {
    throw new Error("Commit message is required and must be a string.");
  }

  const trimmed = message.trim();

  if (trimmed.length === 0) {
    throw new Error("Commit message cannot be empty.");
  }

  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    throw new Error(`Commit message too long (max ${MAX_MESSAGE_LENGTH} characters).`);
  }

  // Check for safe characters only
  if (!SAFE_MESSAGE_PATTERN.test(trimmed)) {
    // Sanitize by removing potentially dangerous characters
    const sanitized = trimmed.replace(/[^\w\s.,!?;:'"()\-\[\]{}@#$%^&*+=/<>|~`]/g, '');
    if (sanitized.length === 0) {
      throw new Error("Commit message contains only invalid characters.");
    }
    return sanitized;
  }

  return trimmed;
}

export async function run(args: { action: 'status' | 'save' | 'diff' | 'log' | 'branch'; message?: string; count?: number }): Promise<string> {
  try {
    switch (args.action) {
      case 'status': {
        const { stdout } = await execFileAsync('git', ['status', '--short']);
        return stdout.trim() || "Clean working tree.";
      }

      case 'save': {
        if (!args.message) {
          return "Error: Commit message required for 'save' action.";
        }

        const safeMessage = validateCommitMessage(args.message);

        // Stage all changes
        await execFileAsync('git', ['add', '.']);

        // Commit with safe message (using execFile prevents shell injection)
        const { stdout } = await execFileAsync('git', ['commit', '-m', safeMessage]);
        return `Git Save Success:\n${stdout}`;
      }

      case 'diff': {
        const { stdout } = await execFileAsync('git', ['diff', '--stat']);
        return stdout.trim() || "No changes detected.";
      }

      case 'log': {
        const count = Math.min(Math.max(1, args.count || 5), 20); // Clamp between 1-20
        const { stdout } = await execFileAsync('git', ['log', `--oneline`, `-n`, count.toString()]);
        return stdout.trim() || "No commits found.";
      }

      case 'branch': {
        const { stdout } = await execFileAsync('git', ['branch', '-v']);
        return stdout.trim() || "No branches found.";
      }

      default:
        return `Unknown action: ${args.action}. Supported: status, save, diff, log, branch`;
    }
  } catch (e: unknown) {
    const error = e as Error & { stderr?: string };
    const message = error.stderr || error.message || 'Unknown error';
    return `Git Error: ${message}`;
  }
}