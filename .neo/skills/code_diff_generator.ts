/* NEO_SKILL_META
{
  "name": "code_diff_generator",
  "description": "Generates unified diffs between files or strings. Supports semantic diff (ignore whitespace), side-by-side view, and patch file generation.",
  "argsSchema": {
    "type": "object",
    "properties": {
      "mode": {
        "type": "string",
        "enum": ["files", "strings"],
        "description": "Compare files or raw strings"
      },
      "oldContent": { "type": "string", "description": "Old file path (mode=files) or old content string (mode=strings)" },
      "newContent": { "type": "string", "description": "New file path (mode=files) or new content string (mode=strings)" },
      "options": {
        "type": "object",
        "properties": {
          "format": { "type": "string", "enum": ["unified", "side-by-side", "inline"], "description": "Output format (default: unified)" },
          "context": { "type": "number", "description": "Lines of context (default: 3)" },
          "ignoreWhitespace": { "type": "boolean", "description": "Ignore whitespace changes (default: false)" },
          "ignoreCase": { "type": "boolean", "description": "Case insensitive comparison (default: false)" }
        }
      },
      "outputPath": { "type": "string", "description": "Optional path to save diff/patch file" }
    },
    "required": ["mode", "oldContent", "newContent"]
  }
}
NEO_SKILL_META */

import fs from 'fs';
import path from 'path';
import { diffLines, diffWords, Change } from 'diff';

interface DiffOptions {
  format?: 'unified' | 'side-by-side' | 'inline';
  context?: number;
  ignoreWhitespace?: boolean;
  ignoreCase?: boolean;
}

interface DiffArgs {
  mode: 'files' | 'strings';
  oldContent: string;
  newContent: string;
  options?: DiffOptions;
  outputPath?: string;
}

export async function run(args: DiffArgs): Promise<string> {
  const { mode, oldContent, newContent, options = {}, outputPath } = args;

  if (!mode || !oldContent || !newContent) {
    return 'Error: mode, oldContent, and newContent are required';
  }

  const {
    format = 'unified',
    context = 3,
    ignoreWhitespace = false,
    ignoreCase = false
  } = options;

  let oldText: string;
  let newText: string;
  let oldName = 'old';
  let newName = 'new';

  try {
    if (mode === 'files') {
      const oldPath = path.resolve(process.cwd(), oldContent);
      const newPath = path.resolve(process.cwd(), newContent);

      if (!fs.existsSync(oldPath)) {
        return `Error: Old file not found: ${oldPath}`;
      }
      if (!fs.existsSync(newPath)) {
        return `Error: New file not found: ${newPath}`;
      }

      oldText = fs.readFileSync(oldPath, 'utf-8');
      newText = fs.readFileSync(newPath, 'utf-8');
      oldName = oldContent;
      newName = newContent;
    } else {
      oldText = oldContent;
      newText = newContent;
    }

    // Apply preprocessing options
    if (ignoreWhitespace) {
      oldText = oldText.replace(/[ \t]+/g, ' ').replace(/^ +| +$/gm, '');
      newText = newText.replace(/[ \t]+/g, ' ').replace(/^ +| +$/gm, '');
    }

    if (ignoreCase) {
      oldText = oldText.toLowerCase();
      newText = newText.toLowerCase();
    }

    // Generate diff
    const changes = diffLines(oldText, newText);

    // Check if there are actual changes
    const hasChanges = changes.some(c => c.added || c.removed);
    if (!hasChanges) {
      return 'No differences found';
    }

    let diffOutput: string;

    switch (format) {
      case 'unified':
        diffOutput = generateUnifiedDiff(changes, oldName, newName, context);
        break;
      case 'side-by-side':
        diffOutput = generateSideBySideDiff(changes);
        break;
      case 'inline':
        diffOutput = generateInlineDiff(oldText, newText);
        break;
      default:
        diffOutput = generateUnifiedDiff(changes, oldName, newName, context);
    }

    // Save to file if requested
    if (outputPath) {
      const absOutput = path.resolve(process.cwd(), outputPath);
      fs.writeFileSync(absOutput, diffOutput, 'utf-8');
      return `Diff saved to: ${outputPath}\n\n${diffOutput}`;
    }

    return diffOutput;

  } catch (e: unknown) {
    return `Error generating diff: ${(e as Error).message}`;
  }
}

function generateUnifiedDiff(changes: Change[], oldName: string, newName: string, context: number): string {
  const lines: string[] = [];
  const timestamp = new Date().toISOString();

  lines.push(`--- ${oldName}\t${timestamp}`);
  lines.push(`+++ ${newName}\t${timestamp}`);

  // Group changes into hunks
  let oldLineNum = 1;
  let newLineNum = 1;
  let currentHunk: string[] = [];
  let hunkOldStart = 0;
  let hunkNewStart = 0;
  let hunkOldCount = 0;
  let hunkNewCount = 0;
  let lastChangeIndex = -1;

  for (let i = 0; i < changes.length; i++) {
    const change = changes[i];
    const changeLines = change.value.split('\n');

    // Remove empty last element if value ends with newline
    if (changeLines[changeLines.length - 1] === '') {
      changeLines.pop();
    }

    if (change.added || change.removed) {
      // Start new hunk if needed
      if (currentHunk.length === 0) {
        hunkOldStart = Math.max(1, oldLineNum - context);
        hunkNewStart = Math.max(1, newLineNum - context);

        // Add context before change
        const contextStart = Math.max(0, i - 1);
        if (contextStart >= 0 && changes[contextStart] && !changes[contextStart].added && !changes[contextStart].removed) {
          const contextLines = changes[contextStart].value.split('\n');
          if (contextLines[contextLines.length - 1] === '') contextLines.pop();
          const start = Math.max(0, contextLines.length - context);
          for (let j = start; j < contextLines.length; j++) {
            currentHunk.push(` ${contextLines[j]}`);
            hunkOldCount++;
            hunkNewCount++;
          }
        }
      }

      // Add the change
      for (const line of changeLines) {
        if (change.removed) {
          currentHunk.push(`-${line}`);
          hunkOldCount++;
          oldLineNum++;
        } else {
          currentHunk.push(`+${line}`);
          hunkNewCount++;
          newLineNum++;
        }
      }

      lastChangeIndex = i;
    } else {
      // Context or gap
      if (currentHunk.length > 0) {
        // Add trailing context
        const contextToAdd = Math.min(context, changeLines.length);
        for (let j = 0; j < contextToAdd; j++) {
          currentHunk.push(` ${changeLines[j]}`);
          hunkOldCount++;
          hunkNewCount++;
        }

        // Check if we need to output the hunk
        const nextChangeIndex = changes.findIndex((c, idx) => idx > i && (c.added || c.removed));
        const gap = nextChangeIndex === -1 ? Infinity : countLines(changes.slice(i + 1, nextChangeIndex));

        if (gap > context * 2 || nextChangeIndex === -1) {
          // Output hunk
          lines.push(`@@ -${hunkOldStart},${hunkOldCount} +${hunkNewStart},${hunkNewCount} @@`);
          lines.push(...currentHunk);

          // Reset hunk
          currentHunk = [];
          hunkOldCount = 0;
          hunkNewCount = 0;
        } else {
          // Continue hunk with gap context
          for (let j = contextToAdd; j < changeLines.length; j++) {
            currentHunk.push(` ${changeLines[j]}`);
            hunkOldCount++;
            hunkNewCount++;
          }
        }
      }

      oldLineNum += changeLines.length;
      newLineNum += changeLines.length;
    }
  }

  // Output final hunk if exists
  if (currentHunk.length > 0) {
    lines.push(`@@ -${hunkOldStart},${hunkOldCount} +${hunkNewStart},${hunkNewCount} @@`);
    lines.push(...currentHunk);
  }

  return lines.join('\n');
}

function countLines(changes: Change[]): number {
  let count = 0;
  for (const change of changes) {
    if (!change.added && !change.removed) {
      const lines = change.value.split('\n');
      count += lines.length - (change.value.endsWith('\n') ? 1 : 0);
    }
  }
  return count;
}

function generateSideBySideDiff(changes: Change[]): string {
  const lines: string[] = [];
  const width = 50;

  lines.push('┌' + '─'.repeat(width) + '┬' + '─'.repeat(width) + '┐');
  lines.push('│' + ' OLD'.padEnd(width) + '│' + ' NEW'.padEnd(width) + '│');
  lines.push('├' + '─'.repeat(width) + '┼' + '─'.repeat(width) + '┤');

  let oldLineNum = 1;
  let newLineNum = 1;

  for (const change of changes) {
    const changeLines = change.value.split('\n');
    if (changeLines[changeLines.length - 1] === '') {
      changeLines.pop();
    }

    for (const line of changeLines) {
      const truncated = line.length > width - 6 ? line.substring(0, width - 9) + '...' : line;

      if (change.removed) {
        const oldSide = `${String(oldLineNum).padStart(4)} -${truncated}`.padEnd(width);
        const newSide = ''.padEnd(width);
        lines.push(`│${oldSide}│${newSide}│`);
        oldLineNum++;
      } else if (change.added) {
        const oldSide = ''.padEnd(width);
        const newSide = `${String(newLineNum).padStart(4)} +${truncated}`.padEnd(width);
        lines.push(`│${oldSide}│${newSide}│`);
        newLineNum++;
      } else {
        const oldSide = `${String(oldLineNum).padStart(4)}  ${truncated}`.padEnd(width);
        const newSide = `${String(newLineNum).padStart(4)}  ${truncated}`.padEnd(width);
        lines.push(`│${oldSide}│${newSide}│`);
        oldLineNum++;
        newLineNum++;
      }
    }
  }

  lines.push('└' + '─'.repeat(width) + '┴' + '─'.repeat(width) + '┘');

  return lines.join('\n');
}

function generateInlineDiff(oldText: string, newText: string): string {
  const wordChanges = diffWords(oldText, newText);
  let result = '';

  for (const change of wordChanges) {
    if (change.removed) {
      result += `[-${change.value}-]`;
    } else if (change.added) {
      result += `{+${change.value}+}`;
    } else {
      result += change.value;
    }
  }

  return result;
}
