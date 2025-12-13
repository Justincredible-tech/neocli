/* NEO_SKILL_META
{
  "name": "shell_executor",
  "description": "Safely executes shell commands with timeout, output capture, and blocked dangerous commands. Use for running build scripts, package managers, and safe system operations.",
  "argsSchema": {
    "type": "object",
    "properties": {
      "command": { "type": "string", "description": "The command to execute" },
      "args": { "type": "array", "items": { "type": "string" }, "description": "Command arguments" },
      "cwd": { "type": "string", "description": "Working directory (optional)" },
      "timeout": { "type": "number", "description": "Timeout in milliseconds (default: 30000)" },
      "shell": { "type": "boolean", "description": "Run in shell mode (default: true)" }
    },
    "required": ["command"]
  }
}
NEO_SKILL_META */

import { spawn } from 'child_process';
import path from 'path';

// Dangerous commands/patterns that should never be executed
const BLOCKED_COMMANDS = [
  'rm -rf /',
  'rm -rf ~',
  'rm -rf /*',
  'rm -rf *',
  'mkfs',
  'dd if=',
  ':(){:|:&};:',  // Fork bomb
  '> /dev/sda',
  'mv /* ',
  'chmod -R 777 /',
  'chown -R',
  'wget | sh',
  'curl | sh',
  'wget | bash',
  'curl | bash',
  '| sh',
  '| bash',
  'shutdown',
  'reboot',
  'halt',
  'poweroff',
  'init 0',
  'init 6',
  'format c:',
  'del /f /s /q c:',
  'rd /s /q c:'
];

// Commands that require extra caution
const WARN_PATTERNS = [
  /rm\s+-rf/i,
  /sudo\s+rm/i,
  /del\s+\/f/i,
  /format\s+/i,
  />\s*\/dev\//i,
  /eval\s*\(/i
];

interface ShellArgs {
  command: string;
  args?: string[];
  cwd?: string;
  timeout?: number;
  shell?: boolean;
}

function isBlocked(cmd: string): boolean {
  const lowerCmd = cmd.toLowerCase();
  return BLOCKED_COMMANDS.some(blocked => lowerCmd.includes(blocked.toLowerCase()));
}

function hasWarning(cmd: string): string | null {
  for (const pattern of WARN_PATTERNS) {
    if (pattern.test(cmd)) {
      return `Warning: Command matches dangerous pattern: ${pattern.toString()}`;
    }
  }
  return null;
}

export async function run(args: ShellArgs): Promise<string> {
  const { command, args: cmdArgs = [], cwd, timeout = 30000, shell = true } = args;

  if (!command || typeof command !== 'string') {
    return 'Error: command is required and must be a string';
  }

  // Build full command string for checking
  const fullCmd = cmdArgs.length > 0 ? `${command} ${cmdArgs.join(' ')}` : command;

  // Security check: Block dangerous commands
  if (isBlocked(fullCmd)) {
    return `Error: Command blocked for safety reasons. This command could cause system damage.`;
  }

  // Warning check
  const warning = hasWarning(fullCmd);

  // Resolve working directory
  const workingDir = cwd ? path.resolve(process.cwd(), cwd) : process.cwd();

  return new Promise((resolve) => {
    try {
      const child = spawn(command, cmdArgs, {
        cwd: workingDir,
        shell,
        timeout,
        windowsHide: true
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      const timeoutId = setTimeout(() => {
        child.kill('SIGTERM');
        resolve(`Error: Command timed out after ${timeout}ms`);
      }, timeout);

      child.on('close', (code: number | null) => {
        clearTimeout(timeoutId);

        // Truncate output if too long
        const maxLen = 5000;
        if (stdout.length > maxLen) {
          stdout = stdout.substring(0, maxLen) + `\n... (truncated ${stdout.length - maxLen} chars)`;
        }
        if (stderr.length > maxLen) {
          stderr = stderr.substring(0, maxLen) + `\n... (truncated ${stderr.length - maxLen} chars)`;
        }

        const parts: string[] = [];

        if (warning) {
          parts.push(warning);
        }

        parts.push(`Exit code: ${code ?? 'null'}`);

        if (stdout.trim()) {
          parts.push(`STDOUT:\n${stdout.trim()}`);
        }

        if (stderr.trim()) {
          parts.push(`STDERR:\n${stderr.trim()}`);
        }

        if (code === 0) {
          resolve(`Success!\n${parts.join('\n')}`);
        } else {
          resolve(`Command failed.\n${parts.join('\n')}`);
        }
      });

      child.on('error', (error: Error) => {
        clearTimeout(timeoutId);
        resolve(`Error spawning process: ${error.message}`);
      });

    } catch (e: unknown) {
      resolve(`Error: ${(e as Error).message}`);
    }
  });
}
