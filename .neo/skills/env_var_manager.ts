/* NEO_SKILL_META
{
  "name": "env_var_manager",
  "description": "Parse and manage .env files. Validate against code usage, generate .env.example templates, compare environments, and detect unused/missing variables.",
  "argsSchema": {
    "type": "object",
    "properties": {
      "action": {
        "type": "string",
        "enum": ["parse", "validate", "generate_example", "compare", "find_usage"],
        "description": "Action to perform"
      },
      "envPath": { "type": "string", "description": "Path to .env file (default: .env)" },
      "options": {
        "type": "object",
        "properties": {
          "codePath": { "type": "string", "description": "Directory to search for env usage (default: src)" },
          "compareWith": { "type": "string", "description": "Second .env file to compare" },
          "redactValues": { "type": "boolean", "description": "Hide sensitive values in output (default: true)" },
          "extensions": { "type": "array", "items": { "type": "string" }, "description": "File extensions to search (default: .ts,.js,.tsx,.jsx)" }
        }
      }
    },
    "required": ["action"]
  }
}
NEO_SKILL_META */

import fs from 'fs';
import path from 'path';
import { glob } from 'glob';

interface EnvArgs {
  action: 'parse' | 'validate' | 'generate_example' | 'compare' | 'find_usage';
  envPath?: string;
  options?: {
    codePath?: string;
    compareWith?: string;
    redactValues?: boolean;
    extensions?: string[];
  };
}

interface EnvVariable {
  key: string;
  value: string;
  line: number;
  hasComment: boolean;
  comment?: string;
}

// Patterns that suggest sensitive data
const SENSITIVE_PATTERNS = [
  /password/i,
  /secret/i,
  /key/i,
  /token/i,
  /auth/i,
  /credential/i,
  /private/i,
  /api_key/i,
  /apikey/i,
  /access_token/i
];

export async function run(args: EnvArgs): Promise<string> {
  const { action, envPath = '.env', options = {} } = args;

  if (!action) {
    return 'Error: action is required';
  }

  try {
    switch (action) {
      case 'parse':
        return parseEnvFile(envPath, options.redactValues ?? true);
      case 'validate':
        return validateEnvUsage(envPath, options);
      case 'generate_example':
        return generateExample(envPath, options.redactValues ?? true);
      case 'compare':
        return compareEnvFiles(envPath, options.compareWith);
      case 'find_usage':
        return findEnvUsage(envPath, options);
      default:
        return `Error: Unknown action "${action}"`;
    }
  } catch (e: unknown) {
    return `Error: ${(e as Error).message}`;
  }
}

function parseEnvContent(content: string): EnvVariable[] {
  const variables: EnvVariable[] = [];
  const lines = content.split('\n');

  let currentComment = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Skip empty lines
    if (!line) {
      currentComment = '';
      continue;
    }

    // Comment line
    if (line.startsWith('#')) {
      currentComment = line.substring(1).trim();
      continue;
    }

    // Parse variable
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (match) {
      let value = match[2];

      // Handle quoted values
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      // Handle inline comments
      const inlineComment = value.match(/\s+#\s*(.+)$/);
      if (inlineComment && !value.startsWith('"') && !value.startsWith("'")) {
        value = value.replace(/\s+#.*$/, '');
      }

      variables.push({
        key: match[1],
        value,
        line: i + 1,
        hasComment: !!currentComment,
        comment: currentComment || undefined
      });

      currentComment = '';
    }
  }

  return variables;
}

function isSensitive(key: string): boolean {
  return SENSITIVE_PATTERNS.some(pattern => pattern.test(key));
}

function redactValue(key: string, value: string): string {
  if (isSensitive(key) || value.length > 50) {
    if (value.length === 0) return '(empty)';
    return value.substring(0, 3) + '*'.repeat(Math.min(value.length - 3, 10)) + '...';
  }
  return value;
}

function parseEnvFile(envPath: string, redact: boolean): string {
  const absPath = path.resolve(process.cwd(), envPath);

  if (!fs.existsSync(absPath)) {
    return `Error: .env file not found at ${absPath}`;
  }

  const content = fs.readFileSync(absPath, 'utf-8');
  const variables = parseEnvContent(content);

  const output: string[] = [];
  output.push(`=== Environment Variables (${envPath}) ===`);
  output.push(`Found: ${variables.length} variables`);
  output.push('');

  // Group by category (based on prefix)
  const byPrefix = new Map<string, EnvVariable[]>();

  for (const v of variables) {
    const prefix = v.key.includes('_') ? v.key.split('_')[0] : 'OTHER';
    if (!byPrefix.has(prefix)) {
      byPrefix.set(prefix, []);
    }
    byPrefix.get(prefix)!.push(v);
  }

  for (const [prefix, vars] of byPrefix) {
    output.push(`[${prefix}]`);
    for (const v of vars) {
      const displayValue = redact ? redactValue(v.key, v.value) : v.value;
      const sensitive = isSensitive(v.key) ? ' (sensitive)' : '';
      output.push(`  ${v.key}=${displayValue}${sensitive}`);
      if (v.comment) {
        output.push(`    # ${v.comment}`);
      }
    }
    output.push('');
  }

  return output.join('\n');
}

async function validateEnvUsage(envPath: string, options: EnvArgs['options']): Promise<string> {
  const { codePath = 'src', extensions = ['.ts', '.js', '.tsx', '.jsx'] } = options || {};

  const absEnvPath = path.resolve(process.cwd(), envPath);
  const absCodePath = path.resolve(process.cwd(), codePath);

  if (!fs.existsSync(absEnvPath)) {
    return `Error: .env file not found at ${absEnvPath}`;
  }

  if (!fs.existsSync(absCodePath)) {
    return `Error: Code directory not found at ${absCodePath}`;
  }

  const content = fs.readFileSync(absEnvPath, 'utf-8');
  const envVars = parseEnvContent(content);
  const envKeys = new Set(envVars.map(v => v.key));

  // Find all process.env usage in code
  const pattern = `**/*{${extensions.join(',')}}`;
  const files = await glob(pattern, { cwd: absCodePath, absolute: true });

  const usedVars = new Set<string>();
  const missingVars = new Set<string>();
  const codeEnvPattern = /process\.env\.([A-Z_][A-Z0-9_]*)|process\.env\[['"]([A-Z_][A-Z0-9_]*)['"]\]/g;

  for (const file of files) {
    const fileContent = fs.readFileSync(file, 'utf-8');
    let match;

    while ((match = codeEnvPattern.exec(fileContent)) !== null) {
      const varName = match[1] || match[2];
      usedVars.add(varName);

      if (!envKeys.has(varName)) {
        missingVars.add(varName);
      }
    }
  }

  // Find unused env vars
  const unusedVars = envVars.filter(v => !usedVars.has(v.key));

  const output: string[] = [];
  output.push('=== Environment Variable Validation ===');
  output.push(`Scanned: ${files.length} files in ${codePath}`);
  output.push(`Defined in .env: ${envVars.length}`);
  output.push(`Used in code: ${usedVars.size}`);
  output.push('');

  if (missingVars.size > 0) {
    output.push(`MISSING from .env (${missingVars.size}):`);
    for (const v of missingVars) {
      output.push(`  ! ${v} - used in code but not defined`);
    }
    output.push('');
  }

  if (unusedVars.length > 0) {
    output.push(`UNUSED (${unusedVars.length}):`);
    for (const v of unusedVars) {
      output.push(`  ? ${v.key} - defined but not found in code`);
    }
    output.push('');
  }

  const validCount = envVars.length - unusedVars.length;
  const issues = missingVars.size + unusedVars.length;

  if (issues === 0) {
    output.push('All environment variables are properly defined and used.');
  } else {
    output.push(`Summary: ${validCount} valid, ${missingVars.size} missing, ${unusedVars.length} unused`);
  }

  return output.join('\n');
}

function generateExample(envPath: string, redact: boolean): string {
  const absPath = path.resolve(process.cwd(), envPath);

  if (!fs.existsSync(absPath)) {
    return `Error: .env file not found at ${absPath}`;
  }

  const content = fs.readFileSync(absPath, 'utf-8');
  const variables = parseEnvContent(content);

  const output: string[] = [];
  output.push('=== Generated .env.example ===');
  output.push('');
  output.push('Copy the content below to create .env.example:');
  output.push('');
  output.push('```');

  let currentPrefix = '';

  for (const v of variables) {
    const prefix = v.key.includes('_') ? v.key.split('_')[0] : '';

    // Add section comment if prefix changes
    if (prefix && prefix !== currentPrefix) {
      if (currentPrefix) output.push('');
      output.push(`# ${prefix} Configuration`);
      currentPrefix = prefix;
    }

    // Add variable comment if exists
    if (v.comment) {
      output.push(`# ${v.comment}`);
    }

    // Generate placeholder value
    let placeholder: string;

    if (isSensitive(v.key)) {
      placeholder = 'your_' + v.key.toLowerCase() + '_here';
    } else if (v.value.match(/^\d+$/)) {
      placeholder = v.value; // Keep numeric defaults
    } else if (v.value === 'true' || v.value === 'false') {
      placeholder = v.value; // Keep boolean defaults
    } else if (v.value.startsWith('http')) {
      placeholder = 'https://example.com'; // URL placeholder
    } else if (v.value.length === 0) {
      placeholder = '';
    } else if (redact && isSensitive(v.key)) {
      placeholder = '';
    } else {
      placeholder = v.value; // Keep other non-sensitive values
    }

    output.push(`${v.key}=${placeholder}`);
  }

  output.push('```');
  output.push('');
  output.push('Note: Sensitive values have been replaced with placeholders.');

  return output.join('\n');
}

function compareEnvFiles(envPath: string, compareWith: string | undefined): string {
  if (!compareWith) {
    return 'Error: compareWith option is required for compare action';
  }

  const absPath1 = path.resolve(process.cwd(), envPath);
  const absPath2 = path.resolve(process.cwd(), compareWith);

  if (!fs.existsSync(absPath1)) {
    return `Error: File not found: ${absPath1}`;
  }
  if (!fs.existsSync(absPath2)) {
    return `Error: File not found: ${absPath2}`;
  }

  const content1 = fs.readFileSync(absPath1, 'utf-8');
  const content2 = fs.readFileSync(absPath2, 'utf-8');

  const vars1 = parseEnvContent(content1);
  const vars2 = parseEnvContent(content2);

  const map1 = new Map(vars1.map(v => [v.key, v]));
  const map2 = new Map(vars2.map(v => [v.key, v]));

  const onlyIn1: string[] = [];
  const onlyIn2: string[] = [];
  const different: { key: string; val1: string; val2: string }[] = [];
  const same: string[] = [];

  for (const [key, v1] of map1) {
    if (!map2.has(key)) {
      onlyIn1.push(key);
    } else {
      const v2 = map2.get(key)!;
      if (v1.value !== v2.value) {
        different.push({ key, val1: v1.value, val2: v2.value });
      } else {
        same.push(key);
      }
    }
  }

  for (const key of map2.keys()) {
    if (!map1.has(key)) {
      onlyIn2.push(key);
    }
  }

  const output: string[] = [];
  output.push('=== Environment File Comparison ===');
  output.push(`File A: ${envPath} (${vars1.length} vars)`);
  output.push(`File B: ${compareWith} (${vars2.length} vars)`);
  output.push('');

  if (onlyIn1.length > 0) {
    output.push(`Only in ${envPath}:`);
    for (const key of onlyIn1) {
      output.push(`  + ${key}`);
    }
    output.push('');
  }

  if (onlyIn2.length > 0) {
    output.push(`Only in ${compareWith}:`);
    for (const key of onlyIn2) {
      output.push(`  - ${key}`);
    }
    output.push('');
  }

  if (different.length > 0) {
    output.push('Different values:');
    for (const d of different) {
      const displayVal1 = isSensitive(d.key) ? '(redacted)' : d.val1.substring(0, 30);
      const displayVal2 = isSensitive(d.key) ? '(redacted)' : d.val2.substring(0, 30);
      output.push(`  ~ ${d.key}`);
      output.push(`      A: ${displayVal1}`);
      output.push(`      B: ${displayVal2}`);
    }
    output.push('');
  }

  output.push(`Summary: ${same.length} same, ${different.length} different, ${onlyIn1.length} only in A, ${onlyIn2.length} only in B`);

  return output.join('\n');
}

async function findEnvUsage(envPath: string, options: EnvArgs['options']): Promise<string> {
  const { codePath = 'src', extensions = ['.ts', '.js', '.tsx', '.jsx'] } = options || {};

  const absEnvPath = path.resolve(process.cwd(), envPath);
  const absCodePath = path.resolve(process.cwd(), codePath);

  if (!fs.existsSync(absEnvPath)) {
    return `Error: .env file not found at ${absEnvPath}`;
  }

  const content = fs.readFileSync(absEnvPath, 'utf-8');
  const envVars = parseEnvContent(content);

  const pattern = `**/*{${extensions.join(',')}}`;
  const files = await glob(pattern, { cwd: absCodePath, absolute: true });

  const usageMap = new Map<string, { file: string; line: number }[]>();

  for (const v of envVars) {
    usageMap.set(v.key, []);
  }

  for (const file of files) {
    const fileContent = fs.readFileSync(file, 'utf-8');
    const lines = fileContent.split('\n');
    const relPath = path.relative(process.cwd(), file);

    for (let i = 0; i < lines.length; i++) {
      for (const v of envVars) {
        if (lines[i].includes(`process.env.${v.key}`) ||
            lines[i].includes(`process.env['${v.key}']`) ||
            lines[i].includes(`process.env["${v.key}"]`)) {
          usageMap.get(v.key)!.push({ file: relPath, line: i + 1 });
        }
      }
    }
  }

  const output: string[] = [];
  output.push('=== Environment Variable Usage ===');
  output.push('');

  for (const [key, usages] of usageMap) {
    if (usages.length === 0) {
      output.push(`${key}: (not found in code)`);
    } else {
      output.push(`${key}: (${usages.length} usage${usages.length > 1 ? 's' : ''})`);
      for (const u of usages.slice(0, 5)) {
        output.push(`    ${u.file}:${u.line}`);
      }
      if (usages.length > 5) {
        output.push(`    ... and ${usages.length - 5} more`);
      }
    }
  }

  return output.join('\n');
}
