/* NEO_SKILL_META
{
  "name": "secret_scanner",
  "description": "Scans a file for potential hardcoded secrets (API Keys, IPs, Private Keys).",
  "argsSchema": {
    "type": "object",
    "properties": {
      "filePath": { "type": "string" }
    },
    "required": ["filePath"]
  }
}
NEO_SKILL_META */

import fs from 'fs';
import path from 'path';

const PATTERNS = [
  { name: 'Generic API Key', regex: /api_key\s*[:=]\s*['"][a-zA-Z0-9]{20,}['"]/i },
  { name: 'AWS Key', regex: /AKIA[0-9A-Z]{16}/ },
  { name: 'Private Key', regex: /BEGIN RSA PRIVATE KEY/ },
  { name: 'Hardcoded IP', regex: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/ }
];

export async function run(args: { filePath: string }) {
  const absPath = path.resolve(process.cwd(), args.filePath);
  if (!fs.existsSync(absPath)) return "File not found.";

  const content = fs.readFileSync(absPath, 'utf-8');
  const warnings = [];

  for (const p of PATTERNS) {
    if (p.regex.test(content)) {
      warnings.push(`⚠️ Found potential ${p.name}`);
    }
  }

  if (warnings.length > 0) {
    return `SECURITY ALERT for ${args.filePath}:\n${warnings.join('\n')}\nPlease review before committing.`;
  }
  return "✅ No obvious secrets found.";
}