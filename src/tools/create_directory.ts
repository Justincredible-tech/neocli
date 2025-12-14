// src/tools/create_directory.ts
/**
 * Create Directory Tool
 * Creates directories with security validation and recursive support.
 */
import { Tool, ToolArgs } from '../types/index.js';
import { SecurityGuard } from '../utils/security.js';
import * as fs from 'fs';

interface CreateDirectoryArgs extends ToolArgs {
  path: string;
  recursive?: boolean;
}

const tool: Tool = {
  name: 'create_directory',
  description: 'Create a new directory. Use recursive:true to create nested directories (e.g., "foo/bar/baz").',
  source: 'CORE',
  requiresApproval: true,
  execute: async (args: ToolArgs): Promise<string> => {
    const {
      path: targetPath,
      recursive = true
    } = args as CreateDirectoryArgs;

    try {
      // 1. Validate inputs
      if (!targetPath || typeof targetPath !== 'string') {
        return "Error: 'path' parameter is required and must be a string.";
      }

      // 2. Security validation
      let fullPath: string;
      try {
        fullPath = SecurityGuard.validatePath(targetPath);
      } catch (secError) {
        return `Security Error: ${(secError as Error).message}`;
      }

      // 3. Check if already exists
      if (fs.existsSync(fullPath)) {
        const stats = fs.statSync(fullPath);
        if (stats.isDirectory()) {
          return `Directory already exists: ${targetPath}`;
        } else {
          return `Error: Path exists but is not a directory: ${targetPath}`;
        }
      }

      // 4. Create the directory
      try {
        fs.mkdirSync(fullPath, { recursive });
      } catch (mkdirError) {
        const err = mkdirError as NodeJS.ErrnoException;
        if (err.code === 'ENOENT' && !recursive) {
          return `Error: Parent directory does not exist. Set recursive:true to create parent directories.`;
        }
        return `Error creating directory: ${err.message}`;
      }

      // 5. Verify creation
      if (!fs.existsSync(fullPath)) {
        return `Error: Directory creation failed silently for: ${targetPath}`;
      }

      return `Created directory: ${targetPath}`;

    } catch (e: unknown) {
      const error = e as Error;
      return `Error: ${error.message}`;
    }
  }
};

export default tool;
