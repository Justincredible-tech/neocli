/* NEO_SKILL_META
{
  "name": "smart_file_editor",
  "description": "Advanced file editing with find/replace (regex support), line insertion/deletion, batch operations, and dry-run preview. Use for precise code modifications.",
  "argsSchema": {
    "type": "object",
    "properties": {
      "filePath": { "type": "string", "description": "Path to the file to edit" },
      "operation": {
        "type": "string",
        "enum": ["find_replace", "insert_lines", "delete_lines", "append", "prepend", "replace_line"],
        "description": "Type of edit operation"
      },
      "config": {
        "type": "object",
        "description": "Operation-specific configuration",
        "properties": {
          "find": { "type": "string", "description": "Text or regex pattern to find" },
          "replace": { "type": "string", "description": "Replacement text" },
          "isRegex": { "type": "boolean", "description": "Treat find as regex (default: false)" },
          "caseSensitive": { "type": "boolean", "description": "Case sensitive search (default: true)" },
          "replaceAll": { "type": "boolean", "description": "Replace all occurrences (default: true)" },
          "lineNumber": { "type": "number", "description": "Line number for line operations (1-indexed)" },
          "startLine": { "type": "number", "description": "Start line for range operations" },
          "endLine": { "type": "number", "description": "End line for range operations" },
          "content": { "type": "string", "description": "Content to insert/append/prepend" },
          "position": { "type": "string", "enum": ["before", "after"], "description": "Insert before or after line" }
        }
      },
      "dryRun": { "type": "boolean", "description": "Preview changes without writing (default: false)" },
      "createBackup": { "type": "boolean", "description": "Create .bak backup file (default: false)" }
    },
    "required": ["filePath", "operation", "config"]
  }
}
NEO_SKILL_META */

import fs from 'fs';
import path from 'path';

interface EditConfig {
  find?: string;
  replace?: string;
  isRegex?: boolean;
  caseSensitive?: boolean;
  replaceAll?: boolean;
  lineNumber?: number;
  startLine?: number;
  endLine?: number;
  content?: string;
  position?: 'before' | 'after';
}

interface EditArgs {
  filePath: string;
  operation: 'find_replace' | 'insert_lines' | 'delete_lines' | 'append' | 'prepend' | 'replace_line';
  config: EditConfig;
  dryRun?: boolean;
  createBackup?: boolean;
}

export async function run(args: EditArgs): Promise<string> {
  const { filePath, operation, config, dryRun = false, createBackup = false } = args;

  if (!filePath || !operation || !config) {
    return 'Error: filePath, operation, and config are all required';
  }

  const absPath = path.resolve(process.cwd(), filePath);

  if (!fs.existsSync(absPath)) {
    return `Error: File not found: ${absPath}`;
  }

  try {
    const originalContent = fs.readFileSync(absPath, 'utf-8');
    let newContent: string;
    let changeDescription: string;

    switch (operation) {
      case 'find_replace': {
        if (config.find === undefined) {
          return 'Error: find_replace requires "find" in config';
        }

        const { find, replace = '', isRegex = false, caseSensitive = true, replaceAll = true } = config;

        let pattern: RegExp;
        if (isRegex) {
          const flags = (caseSensitive ? '' : 'i') + (replaceAll ? 'g' : '');
          try {
            pattern = new RegExp(find, flags);
          } catch (e: unknown) {
            return `Error: Invalid regex pattern: ${(e as Error).message}`;
          }
        } else {
          const escapedFind = find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const flags = (caseSensitive ? '' : 'i') + (replaceAll ? 'g' : '');
          pattern = new RegExp(escapedFind, flags);
        }

        const matches = originalContent.match(pattern);
        const matchCount = matches ? matches.length : 0;

        newContent = originalContent.replace(pattern, replace);
        changeDescription = `Found and replaced ${matchCount} occurrence(s) of "${find}"`;
        break;
      }

      case 'insert_lines': {
        if (config.lineNumber === undefined || config.content === undefined) {
          return 'Error: insert_lines requires "lineNumber" and "content" in config';
        }

        const lines = originalContent.split('\n');
        const { lineNumber, content, position = 'after' } = config;

        if (lineNumber < 1 || lineNumber > lines.length + 1) {
          return `Error: lineNumber ${lineNumber} out of range (1-${lines.length + 1})`;
        }

        const insertIndex = position === 'before' ? lineNumber - 1 : lineNumber;
        const newLines = content.split('\n');

        lines.splice(insertIndex, 0, ...newLines);
        newContent = lines.join('\n');
        changeDescription = `Inserted ${newLines.length} line(s) ${position} line ${lineNumber}`;
        break;
      }

      case 'delete_lines': {
        const lines = originalContent.split('\n');
        const { startLine, endLine, lineNumber } = config;

        let start: number;
        let end: number;

        if (lineNumber !== undefined) {
          start = lineNumber;
          end = lineNumber;
        } else if (startLine !== undefined && endLine !== undefined) {
          start = startLine;
          end = endLine;
        } else {
          return 'Error: delete_lines requires "lineNumber" or both "startLine" and "endLine" in config';
        }

        if (start < 1 || end > lines.length || start > end) {
          return `Error: Invalid line range ${start}-${end} (file has ${lines.length} lines)`;
        }

        const deletedLines = lines.splice(start - 1, end - start + 1);
        newContent = lines.join('\n');
        changeDescription = `Deleted ${deletedLines.length} line(s) (${start}-${end})`;
        break;
      }

      case 'replace_line': {
        if (config.lineNumber === undefined || config.content === undefined) {
          return 'Error: replace_line requires "lineNumber" and "content" in config';
        }

        const lines = originalContent.split('\n');
        const { lineNumber, content } = config;

        if (lineNumber < 1 || lineNumber > lines.length) {
          return `Error: lineNumber ${lineNumber} out of range (1-${lines.length})`;
        }

        const oldLine = lines[lineNumber - 1];
        lines[lineNumber - 1] = content;
        newContent = lines.join('\n');
        changeDescription = `Replaced line ${lineNumber}:\n  Old: ${oldLine.substring(0, 60)}${oldLine.length > 60 ? '...' : ''}\n  New: ${content.substring(0, 60)}${content.length > 60 ? '...' : ''}`;
        break;
      }

      case 'append': {
        if (config.content === undefined) {
          return 'Error: append requires "content" in config';
        }

        newContent = originalContent + (originalContent.endsWith('\n') ? '' : '\n') + config.content;
        changeDescription = `Appended ${config.content.split('\n').length} line(s) to end of file`;
        break;
      }

      case 'prepend': {
        if (config.content === undefined) {
          return 'Error: prepend requires "content" in config';
        }

        newContent = config.content + (config.content.endsWith('\n') ? '' : '\n') + originalContent;
        changeDescription = `Prepended ${config.content.split('\n').length} line(s) to start of file`;
        break;
      }

      default:
        return `Error: Unknown operation "${operation}"`;
    }

    // Check if content actually changed
    if (newContent === originalContent) {
      return 'No changes made - content is identical';
    }

    // Generate diff preview
    const originalLines = originalContent.split('\n');
    const newLines = newContent.split('\n');
    const preview = generateSimpleDiff(originalLines, newLines);

    if (dryRun) {
      return `[DRY RUN] ${changeDescription}\n\nPreview:\n${preview}`;
    }

    // Create backup if requested
    if (createBackup) {
      const backupPath = absPath + '.bak';
      fs.writeFileSync(backupPath, originalContent, 'utf-8');
    }

    // Write changes
    fs.writeFileSync(absPath, newContent, 'utf-8');

    return `Success! ${changeDescription}\n${createBackup ? `Backup created: ${absPath}.bak\n` : ''}File saved: ${filePath}`;

  } catch (e: unknown) {
    return `Error: ${(e as Error).message}`;
  }
}

function generateSimpleDiff(oldLines: string[], newLines: string[]): string {
  const diff: string[] = [];
  const maxPreviewLines = 20;
  let changes = 0;

  // Simple line-by-line comparison
  const maxLen = Math.max(oldLines.length, newLines.length);

  for (let i = 0; i < maxLen && changes < maxPreviewLines; i++) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];

    if (oldLine !== newLine) {
      if (oldLine !== undefined && newLine === undefined) {
        diff.push(`- ${i + 1}: ${oldLine.substring(0, 70)}${oldLine.length > 70 ? '...' : ''}`);
        changes++;
      } else if (oldLine === undefined && newLine !== undefined) {
        diff.push(`+ ${i + 1}: ${newLine.substring(0, 70)}${newLine.length > 70 ? '...' : ''}`);
        changes++;
      } else {
        diff.push(`- ${i + 1}: ${oldLine!.substring(0, 70)}${oldLine!.length > 70 ? '...' : ''}`);
        diff.push(`+ ${i + 1}: ${newLine!.substring(0, 70)}${newLine!.length > 70 ? '...' : ''}`);
        changes += 2;
      }
    }
  }

  if (changes >= maxPreviewLines) {
    diff.push('... (more changes truncated)');
  }

  return diff.length > 0 ? diff.join('\n') : '(no visible changes in preview)';
}
