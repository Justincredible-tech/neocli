/* NEO_SKILL_META
{
  "name": "log_analyzer",
  "description": "Analyzes the agent's debug.log for Errors or specific events.",
  "argsSchema": {
    "type": "object",
    "properties": {
      "lines": { "type": "number", "default": 50 },
      "filter": { "type": "string", "enum": ["ALL", "ERROR", "WARN"], "default": "ERROR" }
    }
  }
}
NEO_SKILL_META */

import fs from 'fs';
import path from 'path';

export async function run(args: { lines?: number; filter?: string }) {
  const logPath = path.join(process.cwd(), '.neo', 'debug.log');
  if (!fs.existsSync(logPath)) return "No debug log found.";

  const content = fs.readFileSync(logPath, 'utf-8');
  const allLines = content.split('\n');
  const limit = args.lines || 50;
  
  // Filter
  const filtered = args.filter && args.filter !== 'ALL'
    ? allLines.filter(l => l.includes(`[${args.filter}]`))
    : allLines;

  // Get last N lines
  const recent = filtered.slice(-limit);
  
  return `Last ${recent.length} lines (${args.filter || 'ALL'}):\n\n` + recent.join('\n');
}