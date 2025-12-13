// src/tools/write_file.ts
/**
 * Write File Tool
 * Writes content to a file with security validation and backup support.
 */
import { Tool, ToolArgs } from '../types/index.js';
import { SecurityGuard } from '../utils/security.js';
import { config } from '../config.js';
import * as fs from 'fs';
import * as path from 'path';

interface WriteFileArgs extends ToolArgs {
  path: string;
  content: string;
  createDirectories?: boolean;
  backup?: boolean;
}

const tool: Tool = {
  name: 'write_file',
  description: 'Write content to a file. Creates the file if it does not exist. Use createDirectories:true to create parent directories if needed.',
  source: 'CORE',
  requiresApproval: true,
  execute: async (args: ToolArgs): Promise<string> => {
    const {
      path: targetPath,
      content,
      createDirectories = true,
      backup = false
    } = args as WriteFileArgs;

    try {
      // 1. Validate inputs
      if (!targetPath || typeof targetPath !== 'string') {
        return "Error: 'path' parameter is required and must be a string.";
      }

      if (content === undefined || content === null) {
        return "Error: 'content' parameter is required.";
      }

      // Convert content to string if needed
      const contentStr = typeof content === 'string' ? content : JSON.stringify(content, null, 2);

      // 2. Security validation
      let fullPath: string;
      try {
        fullPath = SecurityGuard.validatePath(targetPath);
      } catch (secError) {
        return `Security Error: ${(secError as Error).message}`;
      }

      // 3. Check file size limit
      const maxSize = config.filesystem.maxFileSize;
      if (contentStr.length > maxSize) {
        const sizeMB = (contentStr.length / 1024 / 1024).toFixed(2);
        const maxMB = (maxSize / 1024 / 1024).toFixed(0);
        return `Error: Content too large (${sizeMB}MB). Maximum allowed: ${maxMB}MB.`;
      }

      // 4. Create parent directories if needed
      const dirPath = path.dirname(fullPath);
      if (!fs.existsSync(dirPath)) {
        if (createDirectories) {
          try {
            fs.mkdirSync(dirPath, { recursive: true });
          } catch (mkdirError) {
            return `Error creating directories: ${(mkdirError as Error).message}`;
          }
        } else {
          return `Error: Directory '${dirPath}' does not exist. Set createDirectories:true to create it.`;
        }
      }

      // 5. Create backup if requested and file exists
      if (backup && fs.existsSync(fullPath)) {
        const backupPath = `${fullPath}.bak`;
        try {
          fs.copyFileSync(fullPath, backupPath);
        } catch (backupError) {
          return `Error creating backup: ${(backupError as Error).message}`;
        }
      }

      // 6. Determine if this is a new file or overwrite
      const isNewFile = !fs.existsSync(fullPath);
      const action = isNewFile ? 'Created' : 'Updated';

      // 7. Write the file
      fs.writeFileSync(fullPath, contentStr, 'utf-8');

      // 8. Get file stats for confirmation
      const stats = fs.statSync(fullPath);
      const sizeKB = (stats.size / 1024).toFixed(2);
      const lineCount = contentStr.split('\n').length;

      return `${action}: ${targetPath}\n` +
             `  Size: ${sizeKB}KB | Lines: ${lineCount}` +
             (backup && !isNewFile ? `\n  Backup: ${targetPath}.bak` : '');

    } catch (e: unknown) {
      const error = e as Error;
      return `Error writing file: ${error.message}`;
    }
  }
};

export default tool;
