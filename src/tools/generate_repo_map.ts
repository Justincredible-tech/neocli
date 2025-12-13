// src/tools/generate_repo_map.ts
/**
 * Generate Repo Map Tool
 * Generates a compressed map of the codebase structure for agent orientation.
 */
import { Tool, ToolArgs } from '../types/index.js';
import { SecurityGuard } from '../utils/security.js';
import { config } from '../config.js';
import * as fs from 'fs';
import * as path from 'path';

interface RepoMapArgs extends ToolArgs {
  path?: string;
  maxDepth?: number;
}

// Directories to ignore for cleaner output
const IGNORE_DIRS = new Set([
  'node_modules', 'dist', 'coverage', '.git', '.neo', 'build', '.vscode',
  '__pycache__', '.pytest_cache', '.mypy_cache', 'venv', '.venv', 'env'
]);

// File extensions to include in the map
const EXTENSIONS = new Set([
  '.ts', '.js', '.tsx', '.jsx', '.py', '.json', '.md', '.html', '.css',
  '.yaml', '.yml', '.toml', '.ini', '.cfg', '.env.example', '.sh', '.bat',
  '.go', '.rs', '.java', '.c', '.cpp', '.h', '.hpp', '.rb', '.php'
]);

const tool: Tool = {
  name: 'generate_repo_map',
  description: 'Generates a compressed map of the codebase structure. Use this to orient yourself before searching specific files.',
  source: 'CORE',
  execute: async (args: ToolArgs): Promise<string> => {
    const { path: targetPath = '.', maxDepth = 5 } = args as RepoMapArgs;

    try {
      // 1. Security validation
      let fullPath: string;
      try {
        fullPath = SecurityGuard.validatePath(targetPath);
      } catch (secError) {
        return `Security Error: ${(secError as Error).message}`;
      }

      // 2. Safety check: Don't map root directories
      const resolvedPath = path.resolve(fullPath);
      if (resolvedPath === '/' || /^[A-Z]:\\?$/i.test(resolvedPath)) {
        return "Error: Root directory access denied. Please specify a project subfolder.";
      }

      // 3. Verify path exists and is a directory
      if (!fs.existsSync(fullPath)) {
        return `Error: Path '${targetPath}' does not exist.`;
      }

      const stats = fs.statSync(fullPath);
      if (!stats.isDirectory()) {
        return `Error: '${targetPath}' is not a directory.`;
      }

      // 4. Generate the map
      let mapOutput = `PROJECT MAP (${path.basename(resolvedPath)})\n`;
      mapOutput += '═'.repeat(40) + '\n';

      let fileCount = 0;
      let dirCount = 0;

      function walk(currentPath: string, depth: number): string {
        if (depth > maxDepth) return "";

        let output = "";

        let entries: fs.Dirent[];
        try {
          entries = fs.readdirSync(currentPath, { withFileTypes: true });
        } catch {
          return "";
        }

        // Sort: Directories first, then files
        entries.sort((a, b) => {
          if (a.isDirectory() && !b.isDirectory()) return -1;
          if (!a.isDirectory() && b.isDirectory()) return 1;
          return a.name.localeCompare(b.name);
        });

        for (const entry of entries) {
          // Skip hidden files and ignored directories
          if (entry.name.startsWith('.')) continue;
          if (IGNORE_DIRS.has(entry.name)) continue;

          const entryPath = path.join(currentPath, entry.name);
          const prefix = "  ".repeat(depth) + (depth > 0 ? "└─ " : "");

          if (entry.isDirectory()) {
            dirCount++;
            output += `${prefix}📂 ${entry.name}/\n`;
            output += walk(entryPath, depth + 1);
          } else {
            const ext = path.extname(entry.name);
            if (EXTENSIONS.has(ext) || entry.name === 'Makefile' || entry.name === 'Dockerfile') {
              fileCount++;
              try {
                const fileStats = fs.statSync(entryPath);
                const sizeKB = Math.round(fileStats.size / 1024);
                output += `${prefix}📄 ${entry.name} [${sizeKB}KB]\n`;
              } catch {
                output += `${prefix}📄 ${entry.name}\n`;
              }
            }
          }
        }

        return output;
      }

      mapOutput += walk(fullPath, 0);
      mapOutput += '\n' + '─'.repeat(40) + '\n';
      mapOutput += `Summary: ${fileCount} source files in ${dirCount} directories\n`;

      if (fileCount === 0) {
        mapOutput += '\n[Note: No recognized source files found. Check if this is the correct directory.]';
      }

      return mapOutput;

    } catch (e: unknown) {
      const error = e as Error;
      return `Error generating repo map: ${error.message}`;
    }
  }
};

export default tool;
