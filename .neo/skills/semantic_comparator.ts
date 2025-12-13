/* NEO_SKILL_META
{
  "name": "semantic_comparator",
  "description": "Compares two files for structural differences, ignoring whitespace and noise.",
  "argsSchema": {
    "type": "object",
    "properties": {
      "originalPath": { "type": "string", "description": "Path to original file" },
      "modifiedPath": { "type": "string", "description": "Path to modified file" }
    },
    "required": ["originalPath", "modifiedPath"]
  }
}
NEO_SKILL_META */

import fs from 'fs';
import path from 'path';
import * as Diff from 'diff';

export async function run(args: { originalPath: string; modifiedPath: string }) {
  const p1 = path.resolve(process.cwd(), args.originalPath);
  const p2 = path.resolve(process.cwd(), args.modifiedPath);

  if (!fs.existsSync(p1) || !fs.existsSync(p2)) return "Error: One or both files not found.";

  const f1 = fs.readFileSync(p1, 'utf-8');
  const f2 = fs.readFileSync(p2, 'utf-8');

  // 1. Generate Structured Diff
  const changes = Diff.diffLines(f1, f2, { ignoreWhitespace: true });
  
  // 2. Format for Human Reading
  let output = `Diff Report: ${path.basename(p1)} vs ${path.basename(p2)}\n`;
  output += `=================================================\n`;
  
  let hasChanges = false;
  
  changes.forEach(part => {
    if (part.added || part.removed) {
      hasChanges = true;
      const symbol = part.added ? '+' : '-';
      const lines = part.value.split('\n').filter(l => l.trim());
      
      lines.forEach(line => {
        output += `${symbol} | ${line}\n`;
      });
    }
  });

  if (!hasChanges) return "Files are semantically identical (ignoring whitespace).";

  return output;
}