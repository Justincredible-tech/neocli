/* NEO_SKILL_META
{
  "name": "error_stack_parser",
  "description": "Parse error stack traces, map to source files, extract relevant context, and suggest fixes based on common error patterns.",
  "argsSchema": {
    "type": "object",
    "properties": {
      "action": {
        "type": "string",
        "enum": ["parse", "locate", "context", "suggest"],
        "description": "Action to perform"
      },
      "stackTrace": { "type": "string", "description": "The error stack trace to parse" },
      "options": {
        "type": "object",
        "properties": {
          "contextLines": { "type": "number", "description": "Lines of context around error (default: 5)" },
          "includeNodeModules": { "type": "boolean", "description": "Include node_modules in analysis (default: false)" }
        }
      }
    },
    "required": ["action", "stackTrace"]
  }
}
NEO_SKILL_META */

import fs from 'fs';
import path from 'path';

interface StackArgs {
  action: 'parse' | 'locate' | 'context' | 'suggest';
  stackTrace: string;
  options?: {
    contextLines?: number;
    includeNodeModules?: boolean;
  };
}

interface StackFrame {
  function: string;
  file: string;
  line: number;
  column: number;
  isNative: boolean;
  isNodeModule: boolean;
  raw: string;
}

interface ParsedError {
  type: string;
  message: string;
  frames: StackFrame[];
}

// Common error patterns and suggestions
const ERROR_PATTERNS: { pattern: RegExp; type: string; suggestion: string }[] = [
  {
    pattern: /Cannot read propert(?:y|ies) ['"]?(\w+)['"]? of (undefined|null)/i,
    type: 'null_reference',
    suggestion: 'Check if the object exists before accessing property "$1". Use optional chaining (?.) or add null checks.'
  },
  {
    pattern: /(\w+) is not defined/i,
    type: 'reference_error',
    suggestion: '"$1" is not defined. Check for typos, missing imports, or scope issues.'
  },
  {
    pattern: /(\w+) is not a function/i,
    type: 'type_error',
    suggestion: '"$1" is not callable. Verify the import, check if it\'s being called on the right object, or ensure it\'s defined as a function.'
  },
  {
    pattern: /Cannot find module ['"]([^'"]+)['"]/i,
    type: 'module_not_found',
    suggestion: 'Module "$1" not found. Run "npm install $1" or check the import path.'
  },
  {
    pattern: /Unexpected token/i,
    type: 'syntax_error',
    suggestion: 'Syntax error detected. Check for missing brackets, commas, or invalid JSON.'
  },
  {
    pattern: /ENOENT.*['"]([^'"]+)['"]/i,
    type: 'file_not_found',
    suggestion: 'File not found: "$1". Check if the file exists and the path is correct.'
  },
  {
    pattern: /EACCES/i,
    type: 'permission_error',
    suggestion: 'Permission denied. Check file permissions or run with appropriate privileges.'
  },
  {
    pattern: /ECONNREFUSED/i,
    type: 'connection_error',
    suggestion: 'Connection refused. Check if the server is running and the port is correct.'
  },
  {
    pattern: /Maximum call stack size exceeded/i,
    type: 'stack_overflow',
    suggestion: 'Infinite recursion detected. Check for recursive function calls without proper exit conditions.'
  },
  {
    pattern: /out of memory/i,
    type: 'memory_error',
    suggestion: 'Out of memory. Consider processing data in chunks, streams, or increasing Node.js memory limit.'
  },
  {
    pattern: /ETIMEDOUT|timeout/i,
    type: 'timeout',
    suggestion: 'Operation timed out. Increase timeout settings or check network connectivity.'
  },
  {
    pattern: /JSON\.parse.*Unexpected/i,
    type: 'json_parse_error',
    suggestion: 'Invalid JSON format. Validate the JSON string before parsing. Check for trailing commas or unquoted keys.'
  }
];

export async function run(args: StackArgs): Promise<string> {
  const { action, stackTrace, options = {} } = args;

  if (!action || !stackTrace) {
    return 'Error: action and stackTrace are required';
  }

  try {
    switch (action) {
      case 'parse':
        return parseStackTrace(stackTrace, options);
      case 'locate':
        return locateError(stackTrace, options);
      case 'context':
        return getErrorContext(stackTrace, options);
      case 'suggest':
        return suggestFix(stackTrace, options);
      default:
        return `Error: Unknown action "${action}"`;
    }
  } catch (e: unknown) {
    return `Error: ${(e as Error).message}`;
  }
}

function parseError(stackTrace: string): ParsedError {
  const lines = stackTrace.trim().split('\n');

  // Parse error type and message
  let errorType = 'Error';
  let errorMessage = '';

  const firstLine = lines[0] || '';
  const errorMatch = firstLine.match(/^(\w*Error):\s*(.*)/);
  if (errorMatch) {
    errorType = errorMatch[1];
    errorMessage = errorMatch[2];
  } else {
    errorMessage = firstLine;
  }

  // Parse stack frames
  const frames: StackFrame[] = [];

  // V8 stack trace format: "    at functionName (file:line:column)"
  // or "    at file:line:column"
  const frameRegex = /^\s*at\s+(?:(.+?)\s+\()?(?:(.+?):(\d+):(\d+)|([^)]+))\)?$/;

  for (const line of lines.slice(1)) {
    const match = line.match(frameRegex);
    if (match) {
      const funcName = match[1] || '<anonymous>';
      const filePath = match[2] || match[5] || '';
      const lineNum = parseInt(match[3] || '0', 10);
      const colNum = parseInt(match[4] || '0', 10);

      const isNative = filePath.startsWith('node:') || !filePath.includes('/');
      const isNodeModule = filePath.includes('node_modules');

      frames.push({
        function: funcName,
        file: filePath,
        line: lineNum,
        column: colNum,
        isNative,
        isNodeModule,
        raw: line.trim()
      });
    }
  }

  return { type: errorType, message: errorMessage, frames };
}

function parseStackTrace(stackTrace: string, options: StackArgs['options']): string {
  const { includeNodeModules = false } = options || {};
  const parsed = parseError(stackTrace);

  const output: string[] = [];
  output.push('=== Parsed Stack Trace ===');
  output.push('');
  output.push(`Error Type: ${parsed.type}`);
  output.push(`Message: ${parsed.message}`);
  output.push('');
  output.push('Stack Frames:');

  let frameNum = 1;
  for (const frame of parsed.frames) {
    if (!includeNodeModules && frame.isNodeModule) continue;
    if (frame.isNative) continue;

    output.push(`  ${frameNum}. ${frame.function}`);
    output.push(`     ${frame.file}:${frame.line}:${frame.column}`);
    frameNum++;
  }

  if (frameNum === 1) {
    output.push('  (No user code frames found)');
  }

  return output.join('\n');
}

function locateError(stackTrace: string, options: StackArgs['options']): string {
  const { includeNodeModules = false } = options || {};
  const parsed = parseError(stackTrace);

  const output: string[] = [];
  output.push('=== Error Location ===');
  output.push('');
  output.push(`${parsed.type}: ${parsed.message}`);
  output.push('');

  // Find first non-native, non-node_modules frame
  const userFrame = parsed.frames.find(f =>
    !f.isNative && (includeNodeModules || !f.isNodeModule)
  );

  if (!userFrame) {
    output.push('Could not locate error in user code.');
    output.push('');
    output.push('First frame: ' + (parsed.frames[0]?.raw || 'N/A'));
    return output.join('\n');
  }

  output.push('Error occurred at:');
  output.push(`  File: ${userFrame.file}`);
  output.push(`  Line: ${userFrame.line}`);
  output.push(`  Column: ${userFrame.column}`);
  output.push(`  Function: ${userFrame.function}`);

  // Check if file exists and show snippet
  const absPath = path.resolve(process.cwd(), userFrame.file.replace(/^file:\/\//, ''));
  if (fs.existsSync(absPath)) {
    output.push('');
    output.push('File exists: Yes');

    try {
      const content = fs.readFileSync(absPath, 'utf-8');
      const lines = content.split('\n');
      const errorLine = userFrame.line - 1;

      if (errorLine >= 0 && errorLine < lines.length) {
        output.push('');
        output.push('Error line:');
        output.push(`  ${userFrame.line}: ${lines[errorLine]}`);

        if (userFrame.column > 0) {
          output.push(`  ${' '.repeat(String(userFrame.line).length)}  ${' '.repeat(userFrame.column - 1)}^`);
        }
      }
    } catch {
      // Ignore read errors
    }
  } else {
    output.push('');
    output.push('File exists: No (might be transpiled or bundled)');
  }

  return output.join('\n');
}

function getErrorContext(stackTrace: string, options: StackArgs['options']): string {
  const { contextLines = 5, includeNodeModules = false } = options || {};
  const parsed = parseError(stackTrace);

  const output: string[] = [];
  output.push('=== Error Context ===');
  output.push('');
  output.push(`${parsed.type}: ${parsed.message}`);
  output.push('');

  // Get context for each user frame
  const userFrames = parsed.frames.filter(f =>
    !f.isNative && (includeNodeModules || !f.isNodeModule)
  );

  for (const frame of userFrames.slice(0, 3)) {
    const absPath = path.resolve(process.cwd(), frame.file.replace(/^file:\/\//, ''));

    output.push(`--- ${frame.function} ---`);
    output.push(`File: ${frame.file}`);

    if (fs.existsSync(absPath)) {
      try {
        const content = fs.readFileSync(absPath, 'utf-8');
        const lines = content.split('\n');
        const errorLine = frame.line - 1;

        const startLine = Math.max(0, errorLine - contextLines);
        const endLine = Math.min(lines.length - 1, errorLine + contextLines);

        output.push('');
        for (let i = startLine; i <= endLine; i++) {
          const lineNum = String(i + 1).padStart(4);
          const marker = i === errorLine ? ' >> ' : '    ';
          output.push(`${marker}${lineNum} | ${lines[i]}`);
        }
      } catch {
        output.push('(Could not read file)');
      }
    } else {
      output.push('(File not found)');
    }

    output.push('');
  }

  return output.join('\n');
}

function suggestFix(stackTrace: string, options: StackArgs['options']): string {
  const parsed = parseError(stackTrace);

  const output: string[] = [];
  output.push('=== Error Analysis & Suggestions ===');
  output.push('');
  output.push(`${parsed.type}: ${parsed.message}`);
  output.push('');

  // Match against known patterns
  let matched = false;

  for (const errorPattern of ERROR_PATTERNS) {
    const match = parsed.message.match(errorPattern.pattern);
    if (match) {
      matched = true;
      output.push(`Identified: ${errorPattern.type.toUpperCase()}`);
      output.push('');

      let suggestion = errorPattern.suggestion;
      // Replace capture groups
      for (let i = 1; i <= match.length - 1; i++) {
        suggestion = suggestion.replace(`$${i}`, match[i] || '');
      }

      output.push('Suggestion:');
      output.push(`  ${suggestion}`);
      output.push('');
      break;
    }
  }

  if (!matched) {
    output.push('No specific pattern matched.');
    output.push('');
    output.push('General suggestions:');
    output.push('  1. Check the error message for clues');
    output.push('  2. Review the code at the error location');
    output.push('  3. Verify input data and types');
    output.push('  4. Add error handling (try/catch)');
    output.push('  5. Search for the error message online');
    output.push('');
  }

  // Add location info
  const userFrame = parsed.frames.find(f => !f.isNative && !f.isNodeModule);
  if (userFrame) {
    output.push('Error location:');
    output.push(`  ${userFrame.file}:${userFrame.line}:${userFrame.column}`);
    output.push(`  Function: ${userFrame.function}`);
    output.push('');

    output.push('Quick actions:');
    output.push(`  1. Open file at line ${userFrame.line}`);
    output.push('  2. Add console.log before the error line');
    output.push('  3. Check variables are defined and have expected types');
  }

  return output.join('\n');
}
