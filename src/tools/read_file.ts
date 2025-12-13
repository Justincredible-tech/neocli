// src/tools/read_file.ts
/**
 * Read File Tool
 * Reads file contents with pagination, smart 404 recovery, and directory handling.
 */
import { Tool, ToolArgs } from '../types/index.js';
import { SecurityGuard } from '../utils/security.js';
import { config } from '../config.js';
import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';

interface ReadFileArgs extends ToolArgs {
  path: string;
  start_line?: number;
  end_line?: number;
}

const tool: Tool = {
  name: 'read_file',
  description: 'Read a file with optional pagination. If the path is a directory, lists contents. If file not found, searches for similar filenames.',
  source: 'CORE',
  execute: async (args: ToolArgs): Promise<string> => {
    const { path: targetPath, start_line = 1, end_line } = args as ReadFileArgs;

    try {
      // Validate path input
      if (!targetPath || typeof targetPath !== 'string') {
        return "Error: 'path' parameter is required and must be a string.";
      }

      // Security validation
      let fullPath: string;
      try {
        fullPath = SecurityGuard.validatePath(targetPath);
      } catch (secError) {
        return `Security Error: ${(secError as Error).message}`;
      }

      // 1. SMART 404 RECOVERY
      if (!fs.existsSync(fullPath)) {
        const filename = path.basename(targetPath);
        const matches = await glob(`**/${filename}`, {
          ignore: ['node_modules/**', 'dist/**', '.git/**', 'build/**'],
          cwd: process.cwd(),
          maxDepth: 5
        });

        if (matches.length > 0) {
          const suggestions = matches.slice(0, 5).map(m => `- ${m}`).join('\n');
          return `ERROR: File not found at '${targetPath}'.\n\n[SYSTEM HINT]: Found similar files:\n${suggestions}\n\nTry reading one of these paths.`;
        }
        return `Error: File not found at '${targetPath}' and no similar filenames were found.`;
      }

      const stats = fs.statSync(fullPath);

      // 2. DIRECTORY AUTO-HANDLING
      if (stats.isDirectory()) {
        const files = fs.readdirSync(fullPath);
        const formatted = files.map(f => {
          const fPath = path.join(fullPath, f);
          try {
            const fStats = fs.statSync(fPath);
            const prefix = fStats.isDirectory() ? '📂' : '📄';
            return `${prefix} ${f}`;
          } catch {
            return `  ${f}`;
          }
        });
        return `[SYSTEM NOTICE]: '${targetPath}' is a DIRECTORY.\nContents:\n\n${formatted.join('\n')}\n\n(Use 'read_file' on a specific file.)`;
      }

      // 3. SIZE SAFETY
      const maxSize = config.filesystem.maxFileSize;
      if (stats.size > maxSize) {
        const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
        const maxMB = (maxSize / 1024 / 1024).toFixed(0);
        return `Error: File is too large (${sizeMB}MB). Maximum allowed: ${maxMB}MB.`;
      }

      // 4. READ CONTENT
      const content = fs.readFileSync(fullPath, 'utf-8');
      const lines = content.split('\n');
      const totalLines = lines.length;

      // Validate line numbers
      const startLine = Math.max(1, Math.floor(start_line || 1));
      const start = startLine - 1;
      const end = end_line ? Math.min(totalLines, Math.floor(end_line)) : totalLines;

      if (start >= totalLines) {
        return `Error: start_line ${startLine} exceeds total lines (${totalLines}).`;
      }

      const selectedLines = lines.slice(start, end);
      const output = selectedLines.join('\n');

      const metaHeader = `--- FILE: ${targetPath} (lines ${start + 1}-${end} of ${totalLines}) ---\n`;
      const footer = end < totalLines
        ? `\n\n[SYSTEM]: ${totalLines - end} lines remaining. Use start_line=${end + 1} to continue.`
        : `\n\n[SYSTEM]: End of file.`;

      return metaHeader + output + footer;

    } catch (e: unknown) {
      const error = e as Error;
      return `Error reading file: ${error.message}`;
    }
  }
};

export default tool;