/* NEO_SKILL_META
{
  "name": "code_linter",
  "description": "Formats and lints code using Prettier and ESLint. Can auto-fix issues.",
  "argsSchema": {
    "type": "object",
    "properties": {
      "filePath": { "type": "string", "description": "Path to the file to lint" },
      "fix": { "type": "boolean", "description": "Attempt to auto-fix errors (default: true)" }
    },
    "required": ["filePath"]
  }
}
NEO_SKILL_META */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execAsync = promisify(exec);

export async function run(args: { filePath: string; fix?: boolean }) {
  const { filePath, fix = true } = args;
  const absPath = path.resolve(process.cwd(), filePath);
  
  if (!fs.existsSync(absPath)) return `Error: File not found at ${absPath}`;

  const results = [];

  // 1. Prettier (Formatting)
  try {
    const writeFlag = fix ? '--write' : '--check';
    // Uses local project prettier if available, falls back to npx
    await execAsync(`npx prettier "${absPath}" ${writeFlag}`);
    results.push(`✅ Prettier: ${fix ? 'Formatted' : 'Checked clean'}`);
  } catch (e: any) {
    results.push(`❌ Prettier Issues:\n${e.stdout || e.message}`);
  }

  // 2. ESLint (Logic/Quality) - Only for JS/TS
  if (/\.(ts|js|tsx|jsx)$/.test(absPath)) {
    try {
      const fixFlag = fix ? '--fix' : '';
      // We assume a basic eslint config exists or use default
      await execAsync(`npx eslint "${absPath}" ${fixFlag} --no-error-on-unmatched-pattern`);
      results.push(`✅ ESLint: ${fix ? 'Fixed auto-fixable issues' : 'No errors found'}`);
    } catch (e: any) {
      // ESLint exits with 1 if it finds errors
      results.push(`⚠️ ESLint found issues:\n${e.stdout}`);
    }
  }

  return results.join('\n\n');
}