// src/tools/recursive_grep.ts
import { Tool, ToolArgs } from '../types/index.js';
import { glob } from 'glob';
import * as fs from 'fs';
import * as path from 'path';
import { SecurityGuard } from '../utils/security.js';
import { config } from '../config.js';

interface GrepArgs extends ToolArgs {
  pattern: string;
  path?: string;
  caseSensitive?: boolean;
  maxResults?: number;
}

const tool: Tool = {
  name: 'recursive_grep',
  description: 'Search for SPECIFIC patterns in code files. Supports regex patterns with safety validation. DO NOT use for listing files or general exploration.',
  source: 'CORE',
  execute: async (args: ToolArgs): Promise<string> => {
    const { pattern, path: searchPath, caseSensitive = false, maxResults } = args as GrepArgs;

    try {
      // 1. Validate pattern exists
      if (!pattern || typeof pattern !== 'string') {
        return "SYSTEM ERROR: Pattern is required and must be a string.";
      }

      const trimmedPattern = pattern.trim();

      // 2. Guard against lazy/dangerous searching
      const lazyPatterns = ['.*', '*', '^.*$', '.+', '^.+$', '\\s*', '\\S*', ''];
      if (lazyPatterns.includes(trimmedPattern)) {
        return "SYSTEM ERROR: Wildcard-only patterns are not allowed as they flood the context window.\n- To see files, use 'list_files'.\n- To see structure, look at <REPO_MAP> in your system prompt.";
      }

      // 3. Validate regex pattern for safety (ReDoS prevention)
      try {
        SecurityGuard.validateRegexPattern(trimmedPattern);
      } catch (securityError) {
        return `SECURITY ERROR: ${(securityError as Error).message}`;
      }

      // 4. Compile regex with timeout protection
      let regex: RegExp;
      try {
        regex = new RegExp(trimmedPattern, caseSensitive ? 'g' : 'gi');
      } catch (regexError) {
        return `REGEX ERROR: Invalid pattern - ${(regexError as Error).message}`;
      }

      // 5. Resolve and validate search path
      const cwd = process.cwd();
      const resolvedSearchPath = searchPath ? path.resolve(cwd, searchPath) : cwd;

      // Security check on search path
      try {
        SecurityGuard.validatePath(searchPath || '.');
      } catch (pathError) {
        return `PATH ERROR: ${(pathError as Error).message}`;
      }

      // 6. Find files to search
      const extensionGlob = `**/*.{${config.search.searchableExtensions.join(',')}}`;
      const files = await glob(extensionGlob, {
        cwd: resolvedSearchPath,
        ignore: ['node_modules/**', 'dist/**', 'build/**', '.git/**', '.neo/memory.json', '.neo/memory/**', 'coverage/**'],
        nodir: true,
        maxDepth: 10
      });

      if (files.length === 0) {
        return "No searchable files found in the specified path.";
      }

      // Limit files to search
      const filesToSearch = files.slice(0, config.search.maxFiles);
      const effectiveMaxResults = Math.min(maxResults || config.search.maxResults, config.search.maxResults);

      // 7. Search files with safety limits
      const results: string[] = [];
      let filesSearched = 0;
      let filesSkipped = 0;

      for (const file of filesToSearch) {
        if (results.length >= effectiveMaxResults) break;

        const fullPath = path.resolve(resolvedSearchPath, file);

        try {
          // Check file size before reading
          const stats = fs.statSync(fullPath);
          if (stats.size > config.search.maxFileSize) {
            filesSkipped++;
            continue;
          }

          const content = fs.readFileSync(fullPath, 'utf-8');
          const lines = content.split('\n');

          for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            if (results.length >= effectiveMaxResults) break;

            const line = lines[lineIndex];

            // Reset regex lastIndex for each line (important for 'g' flag)
            regex.lastIndex = 0;

            if (regex.test(line)) {
              // Strict truncation to prevent context flooding
              const cleanLine = line.trim().substring(0, 100);
              const truncated = line.trim().length > 100 ? '...' : '';
              results.push(`${file}:${lineIndex + 1}: ${cleanLine}${truncated}`);
            }
          }

          filesSearched++;
        } catch (fileError) {
          // Skip files that can't be read (permission issues, etc.)
          filesSkipped++;
        }
      }

      // 8. Format results
      if (results.length === 0) {
        return `No matches found for pattern "${trimmedPattern}" in ${filesSearched} files.`;
      }

      let output = results.join('\n');

      // Add metadata footer
      const metadata: string[] = [];
      if (results.length >= effectiveMaxResults) {
        metadata.push(`[Results limited to ${effectiveMaxResults} matches]`);
      }
      if (filesSkipped > 0) {
        metadata.push(`[${filesSkipped} files skipped (too large or unreadable)]`);
      }
      if (files.length > config.search.maxFiles) {
        metadata.push(`[Searched ${config.search.maxFiles} of ${files.length} total files]`);
      }

      if (metadata.length > 0) {
        output += '\n\n' + metadata.join('\n');
        output += '\n\nUse \'read_file\' on specific files to examine them in detail.';
      }

      return output;

    } catch (e: unknown) {
      const error = e as Error;
      return `Grep failed: ${error.message}`;
    }
  }
};

export default tool;