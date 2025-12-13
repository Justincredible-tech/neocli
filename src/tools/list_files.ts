// src/tools/list_files.ts
/**
 * List Files Tool
 * Lists directory contents with detailed information and filtering options.
 */
import { Tool, ToolArgs } from '../types/index.js';
import { SecurityGuard } from '../utils/security.js';
import { config } from '../config.js';
import * as fs from 'fs';
import * as path from 'path';

interface ListFilesArgs extends ToolArgs {
  path: string;
  recursive?: boolean;
  maxDepth?: number;
  showHidden?: boolean;
  pattern?: string;
}

interface FileInfo {
  name: string;
  type: 'file' | 'directory' | 'symlink' | 'other';
  size: number;
  modified: Date;
}

const tool: Tool = {
  name: 'list_files',
  description: 'List files and directories at a given path. Supports recursive listing with depth control and pattern filtering.',
  source: 'CORE',
  execute: async (args: ToolArgs): Promise<string> => {
    const {
      path: targetPath = '.',
      recursive = false,
      maxDepth = 3,
      showHidden = false,
      pattern
    } = args as ListFilesArgs;

    try {
      // 1. Security validation
      let fullPath: string;
      try {
        fullPath = SecurityGuard.validatePath(targetPath);
      } catch (secError) {
        return `Security Error: ${(secError as Error).message}`;
      }

      // 2. Check if path exists
      if (!fs.existsSync(fullPath)) {
        return `Error: Path '${targetPath}' does not exist.`;
      }

      // 3. Check if it's a directory
      const stats = fs.statSync(fullPath);
      if (!stats.isDirectory()) {
        // If it's a file, return file info
        const sizeKB = (stats.size / 1024).toFixed(2);
        return `File: ${targetPath}\n` +
               `  Size: ${sizeKB}KB\n` +
               `  Modified: ${stats.mtime.toISOString()}\n` +
               `  Type: ${path.extname(targetPath) || 'no extension'}`;
      }

      // 4. Build pattern matcher if provided
      let patternRegex: RegExp | null = null;
      if (pattern) {
        try {
          // Convert glob-like pattern to regex
          const regexPattern = pattern
            .replace(/\./g, '\\.')
            .replace(/\*/g, '.*')
            .replace(/\?/g, '.');
          patternRegex = new RegExp(`^${regexPattern}$`, 'i');
        } catch {
          return `Error: Invalid pattern '${pattern}'.`;
        }
      }

      // 5. List files
      const ignoreDirs = new Set(config.filesystem.ignoredDirectories);
      const results: string[] = [];
      let fileCount = 0;
      let dirCount = 0;
      let totalSize = 0;

      function listDir(dirPath: string, depth: number, prefix: string): void {
        if (depth > maxDepth) {
          results.push(`${prefix}... (max depth reached)`);
          return;
        }

        let entries: fs.Dirent[];
        try {
          entries = fs.readdirSync(dirPath, { withFileTypes: true });
        } catch (e) {
          results.push(`${prefix}[Permission denied]`);
          return;
        }

        // Sort: directories first, then alphabetically
        entries.sort((a, b) => {
          if (a.isDirectory() && !b.isDirectory()) return -1;
          if (!a.isDirectory() && b.isDirectory()) return 1;
          return a.name.localeCompare(b.name);
        });

        for (let i = 0; i < entries.length; i++) {
          const entry = entries[i];
          const isLast = i === entries.length - 1;

          // Skip hidden files unless requested
          if (!showHidden && entry.name.startsWith('.')) continue;

          // Skip ignored directories
          if (entry.isDirectory() && ignoreDirs.has(entry.name)) continue;

          // Apply pattern filter
          if (patternRegex && !patternRegex.test(entry.name)) continue;

          const entryPath = path.join(dirPath, entry.name);
          const connector = isLast ? '└── ' : '├── ';
          const childPrefix = prefix + (isLast ? '    ' : '│   ');

          try {
            const entryStats = fs.statSync(entryPath);

            if (entry.isDirectory()) {
              dirCount++;
              results.push(`${prefix}${connector}📂 ${entry.name}/`);

              if (recursive) {
                listDir(entryPath, depth + 1, childPrefix);
              }
            } else if (entry.isFile()) {
              fileCount++;
              totalSize += entryStats.size;
              const sizeKB = (entryStats.size / 1024).toFixed(1);
              results.push(`${prefix}${connector}📄 ${entry.name} (${sizeKB}KB)`);
            } else if (entry.isSymbolicLink()) {
              results.push(`${prefix}${connector}🔗 ${entry.name} -> [symlink]`);
            }
          } catch {
            results.push(`${prefix}${connector}⚠️ ${entry.name} [inaccessible]`);
          }
        }
      }

      // Start listing
      results.push(`📂 ${path.basename(fullPath)}/`);
      listDir(fullPath, 0, '');

      // Add summary
      const totalSizeKB = (totalSize / 1024).toFixed(2);
      const totalSizeMB = (totalSize / 1024 / 1024).toFixed(2);
      const sizeStr = totalSize > 1024 * 1024 ? `${totalSizeMB}MB` : `${totalSizeKB}KB`;

      results.push('');
      results.push(`Summary: ${fileCount} files, ${dirCount} directories (${sizeStr} total)`);

      if (!recursive && dirCount > 0) {
        results.push(`[Tip: Use recursive:true to see subdirectory contents]`);
      }

      return results.join('\n');

    } catch (e: unknown) {
      const error = e as Error;
      return `Error listing files: ${error.message}`;
    }
  }
};

export default tool;
