// src/tools/change_directory.ts
/**
 * Change Directory Tool
 * Changes the current working directory within the allowed root.
 */
import { Tool, ToolArgs } from '../types/index.js';
import * as fs from 'fs';
import * as path from 'path';

interface ChangeDirectoryArgs extends ToolArgs {
  path: string;
}

/** Store the original root directory to prevent escaping */
let rootDirectory: string | null = null;

/**
 * Gets or initializes the root directory.
 * The root is locked to the cwd at first use to prevent escape.
 */
function getRootDirectory(): string {
  if (!rootDirectory) {
    rootDirectory = process.cwd();
  }
  return rootDirectory;
}

const tool: Tool = {
  name: 'change_directory',
  description: 'Change the current working directory. Can only navigate within the project root directory. Use ".." to go up, or specify a relative/absolute path.',
  source: 'CORE',
  requiresApproval: false,
  execute: async (args: ToolArgs): Promise<string> => {
    const { path: targetPath } = args as ChangeDirectoryArgs;

    try {
      // 1. Validate inputs
      if (!targetPath || typeof targetPath !== 'string') {
        return "Error: 'path' parameter is required and must be a string.";
      }

      const root = getRootDirectory();
      const currentDir = process.cwd();

      // 2. Handle special cases
      if (targetPath === '~' || targetPath === '/') {
        // Go to root directory
        process.chdir(root);
        return `Changed directory to: ${root} (project root)`;
      }

      // 3. Resolve the target path
      const cleanPath = targetPath.replace(/\0/g, ''); // Remove null bytes
      const resolved = path.resolve(currentDir, cleanPath);

      // 4. Security: Ensure we stay within root directory
      if (!resolved.startsWith(root + path.sep) && resolved !== root) {
        return `Security Error: Cannot navigate outside project root.\n` +
               `  Root: ${root}\n` +
               `  Attempted: ${resolved}`;
      }

      // 5. Check if target exists and is a directory
      if (!fs.existsSync(resolved)) {
        return `Error: Directory does not exist: ${targetPath}\n` +
               `  Resolved to: ${resolved}`;
      }

      const stats = fs.statSync(resolved);
      if (!stats.isDirectory()) {
        return `Error: Path is not a directory: ${targetPath}`;
      }

      // 6. Change directory
      const previousDir = currentDir;
      process.chdir(resolved);

      // 7. Calculate relative paths for display
      const relativeNew = path.relative(root, resolved) || '.';
      const relativePrev = path.relative(root, previousDir) || '.';

      return `Changed directory: ${relativePrev} -> ${relativeNew}\n` +
             `  Full path: ${resolved}`;

    } catch (e: unknown) {
      const error = e as Error;
      return `Error changing directory: ${error.message}`;
    }
  }
};

export default tool;
