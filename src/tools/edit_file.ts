// src/tools/edit_file.ts
/**
 * Edit File Tool
 * Performs targeted, diff-based edits on files.
 * Similar to Claude Code's Edit tool - find and replace specific content.
 */
import { Tool, ToolArgs } from '../types/index.js';
import { SecurityGuard } from '../utils/security.js';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';

interface EditFileArgs extends ToolArgs {
  path: string;
  old_string: string;
  new_string: string;
  expected_count?: number;  // How many replacements expected (for validation)
  dry_run?: boolean;        // Preview without saving
}

/**
 * Generates a simple unified diff for display.
 */
function generateDiff(filePath: string, oldContent: string, newContent: string, oldStr: string, newStr: string): string {
  const lines: string[] = [];

  lines.push(chalk.green(`--- a/${filePath}`));
  lines.push(chalk.green(`+++ b/${filePath}`));

  // Find the context around the change
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');

  // Find where the change starts
  let changeStart = -1;
  const oldStrLines = oldStr.split('\n');

  for (let i = 0; i < oldLines.length; i++) {
    if (oldLines.slice(i, i + oldStrLines.length).join('\n') === oldStr) {
      changeStart = i;
      break;
    }
  }

  if (changeStart === -1) {
    // Fallback: just show the strings
    lines.push(chalk.green('@@ change @@'));
    for (const line of oldStr.split('\n')) {
      lines.push(chalk.red(`- ${line}`));
    }
    for (const line of newStr.split('\n')) {
      lines.push(chalk.greenBright(`+ ${line}`));
    }
    return lines.join('\n');
  }

  // Show context (3 lines before and after)
  const contextBefore = 3;
  const contextAfter = 3;
  const startLine = Math.max(0, changeStart - contextBefore);
  const oldStrLineCount = oldStrLines.length;
  const newStrLines = newStr.split('\n');
  const newStrLineCount = newStrLines.length;
  const endLine = Math.min(oldLines.length, changeStart + oldStrLineCount + contextAfter);

  lines.push(chalk.cyan(`@@ -${startLine + 1},${endLine - startLine} +${startLine + 1},${endLine - startLine - oldStrLineCount + newStrLineCount} @@`));

  // Lines before
  for (let i = startLine; i < changeStart; i++) {
    lines.push(chalk.gray(` ${oldLines[i]}`));
  }

  // Removed lines
  for (const line of oldStrLines) {
    lines.push(chalk.red(`-${line}`));
  }

  // Added lines
  for (const line of newStrLines) {
    lines.push(chalk.greenBright(`+${line}`));
  }

  // Lines after
  for (let i = changeStart + oldStrLineCount; i < endLine; i++) {
    lines.push(chalk.gray(` ${oldLines[i]}`));
  }

  return lines.join('\n');
}

const tool: Tool = {
  name: 'edit_file',
  description: 'Edit a file by replacing a specific string with new content. Use for targeted code changes. Requires exact match of old_string.',
  source: 'CORE',
  requiresApproval: true,
  execute: async (args: ToolArgs): Promise<string> => {
    const {
      path: filePath,
      old_string,
      new_string,
      expected_count,
      dry_run = false
    } = args as EditFileArgs;

    try {
      // 1. Validate inputs
      if (!filePath || typeof filePath !== 'string') {
        return "Error: 'path' parameter is required.";
      }

      if (old_string === undefined || old_string === null) {
        return "Error: 'old_string' parameter is required.";
      }

      if (new_string === undefined || new_string === null) {
        return "Error: 'new_string' parameter is required.";
      }

      if (old_string === new_string) {
        return "Error: old_string and new_string are identical. No change needed.";
      }

      // 2. Security validation
      let fullPath: string;
      try {
        fullPath = SecurityGuard.validatePath(filePath);
      } catch (secError) {
        return `Security Error: ${(secError as Error).message}`;
      }

      // 3. Check file exists
      if (!fs.existsSync(fullPath)) {
        return `Error: File not found: ${filePath}`;
      }

      // 4. Read the file
      const originalContent = fs.readFileSync(fullPath, 'utf-8');

      // 5. Count occurrences of old_string
      let count = 0;
      let searchPos = 0;
      while (true) {
        const pos = originalContent.indexOf(old_string, searchPos);
        if (pos === -1) break;
        count++;
        searchPos = pos + 1;
      }

      if (count === 0) {
        // Try to help the user find similar content
        const firstLine = old_string.split('\n')[0].trim();
        const similarLines = originalContent.split('\n')
          .map((line, idx) => ({ line: line.trim(), num: idx + 1 }))
          .filter(({ line }) => line.includes(firstLine.substring(0, 20)) ||
                               firstLine.includes(line.substring(0, 20)))
          .slice(0, 3);

        let hint = '';
        if (similarLines.length > 0) {
          hint = '\n\nPossible similar content found at:\n' +
            similarLines.map(({ line, num }) => `  Line ${num}: ${line.substring(0, 60)}...`).join('\n');
        }

        return `Error: old_string not found in file.${hint}\n\nMake sure the string matches exactly (including whitespace and indentation).`;
      }

      // 6. Validate expected count if provided
      if (expected_count !== undefined && count !== expected_count) {
        return `Error: Expected ${expected_count} occurrence(s) but found ${count}. ` +
               `Please provide a more specific old_string to match exactly what you want to change.`;
      }

      // 7. Warn if multiple occurrences and no expected_count
      if (count > 1 && expected_count === undefined) {
        return `Warning: Found ${count} occurrences of old_string. All will be replaced.\n` +
               `If this is intended, add expected_count: ${count} to confirm.\n` +
               `Otherwise, provide a more specific old_string.`;
      }

      // 8. Perform the replacement
      const newContent = originalContent.split(old_string).join(new_string);

      // 9. Generate diff preview
      const diff = generateDiff(filePath, originalContent, newContent, old_string, new_string);

      // 10. Dry run - just show diff
      if (dry_run) {
        return `[DRY RUN] Preview of changes:\n\n${diff}\n\n` +
               `${count} replacement(s) would be made. Remove dry_run to apply.`;
      }

      // 11. Write the file
      fs.writeFileSync(fullPath, newContent, 'utf-8');

      // 12. Calculate stats
      const linesChanged = new_string.split('\n').length - old_string.split('\n').length;
      const linesInfo = linesChanged === 0 ? 'same line count' :
                        linesChanged > 0 ? `+${linesChanged} lines` : `${linesChanged} lines`;

      return `✓ Edited ${filePath}\n` +
             `  ${count} replacement(s) made (${linesInfo})\n\n` +
             `${diff}`;

    } catch (e: unknown) {
      const error = e as Error;
      return `Error editing file: ${error.message}`;
    }
  }
};

export default tool;
