/* NEO_SKILL_META
{
  "name": "code_metrics_reporter",
  "description": "Generate code metrics: lines of code by file/language, complexity analysis, technical debt scoring, and maintainability index.",
  "argsSchema": {
    "type": "object",
    "properties": {
      "action": {
        "type": "string",
        "enum": ["loc", "complexity", "debt", "maintainability", "full"],
        "description": "Metrics to generate"
      },
      "path": { "type": "string", "description": "File or directory to analyze" },
      "options": {
        "type": "object",
        "properties": {
          "exclude": { "type": "array", "items": { "type": "string" }, "description": "Patterns to exclude" },
          "format": { "type": "string", "enum": ["summary", "detailed", "json"], "description": "Output format" },
          "groupBy": { "type": "string", "enum": ["file", "language", "directory"], "description": "How to group results" }
        }
      }
    },
    "required": ["action", "path"]
  }
}
NEO_SKILL_META */

import fs from 'fs';
import path from 'path';
import { glob } from 'glob';

interface MetricsArgs {
  action: 'loc' | 'complexity' | 'debt' | 'maintainability' | 'full';
  path: string;
  options?: {
    exclude?: string[];
    format?: 'summary' | 'detailed' | 'json';
    groupBy?: 'file' | 'language' | 'directory';
  };
}

interface FileMetrics {
  file: string;
  language: string;
  loc: {
    total: number;
    code: number;
    comment: number;
    blank: number;
  };
  complexity: {
    cyclomatic: number;
    cognitive: number;
    functions: number;
  };
  maintainability: number;
  debtScore: number;
}

const LANGUAGE_MAP: Record<string, string> = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript/React',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript/React',
  '.py': 'Python',
  '.java': 'Java',
  '.go': 'Go',
  '.rs': 'Rust',
  '.c': 'C',
  '.cpp': 'C++',
  '.h': 'C/C++ Header',
  '.cs': 'C#',
  '.rb': 'Ruby',
  '.php': 'PHP',
  '.swift': 'Swift',
  '.kt': 'Kotlin',
  '.scala': 'Scala',
  '.vue': 'Vue',
  '.svelte': 'Svelte',
  '.css': 'CSS',
  '.scss': 'SCSS',
  '.less': 'Less',
  '.html': 'HTML',
  '.json': 'JSON',
  '.yaml': 'YAML',
  '.yml': 'YAML',
  '.xml': 'XML',
  '.md': 'Markdown',
  '.sql': 'SQL',
  '.sh': 'Shell',
  '.bash': 'Bash'
};

export async function run(args: MetricsArgs): Promise<string> {
  const { action, path: inputPath, options = {} } = args;

  if (!action || !inputPath) {
    return 'Error: action and path are required';
  }

  try {
    switch (action) {
      case 'loc':
        return generateLocReport(inputPath, options);
      case 'complexity':
        return generateComplexityReport(inputPath, options);
      case 'debt':
        return generateDebtReport(inputPath, options);
      case 'maintainability':
        return generateMaintainabilityReport(inputPath, options);
      case 'full':
        return generateFullReport(inputPath, options);
      default:
        return `Error: Unknown action "${action}"`;
    }
  } catch (e: unknown) {
    return `Error: ${(e as Error).message}`;
  }
}

async function getFiles(inputPath: string, exclude: string[] = []): Promise<string[]> {
  const absPath = path.resolve(process.cwd(), inputPath);

  if (!fs.existsSync(absPath)) {
    throw new Error(`Path not found: ${absPath}`);
  }

  if (fs.statSync(absPath).isFile()) {
    return [absPath];
  }

  const defaultExclude = ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**', '**/coverage/**'];
  const allExclude = [...defaultExclude, ...exclude];

  return glob('**/*.*', {
    cwd: absPath,
    absolute: true,
    ignore: allExclude,
    nodir: true
  });
}

function analyzeFile(filePath: string): FileMetrics {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const ext = path.extname(filePath).toLowerCase();
  const language = LANGUAGE_MAP[ext] || 'Other';

  // LOC analysis
  let codeLines = 0;
  let commentLines = 0;
  let blankLines = 0;
  let inBlockComment = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      blankLines++;
      continue;
    }

    // Handle block comments
    if (inBlockComment) {
      commentLines++;
      if (trimmed.includes('*/')) {
        inBlockComment = false;
      }
      continue;
    }

    if (trimmed.startsWith('/*')) {
      commentLines++;
      if (!trimmed.includes('*/')) {
        inBlockComment = true;
      }
      continue;
    }

    if (trimmed.startsWith('//') || trimmed.startsWith('#')) {
      commentLines++;
      continue;
    }

    codeLines++;
  }

  // Complexity analysis
  const complexity = calculateComplexity(content);

  // Maintainability index (simplified)
  // MI = 171 - 5.2 * ln(HV) - 0.23 * CC - 16.2 * ln(LOC)
  // Simplified version
  const mi = Math.max(0, Math.min(100,
    171 - 5.2 * Math.log(codeLines + 1) - 0.23 * complexity.cyclomatic - 16.2 * Math.log(codeLines + 1)
  ));

  // Technical debt score (simplified)
  const debtScore = calculateDebtScore(content, complexity, codeLines);

  return {
    file: filePath,
    language,
    loc: {
      total: lines.length,
      code: codeLines,
      comment: commentLines,
      blank: blankLines
    },
    complexity,
    maintainability: Math.round(mi),
    debtScore
  };
}

function calculateComplexity(content: string): FileMetrics['complexity'] {
  let cyclomatic = 1;
  let cognitive = 0;
  let functions = 0;

  // Count decision points for cyclomatic complexity
  const patterns = [
    /\bif\s*\(/g,
    /\belse\s+if\s*\(/g,
    /\bfor\s*\(/g,
    /\bwhile\s*\(/g,
    /\bdo\s*\{/g,
    /\bcase\s+[^:]+:/g,
    /\bcatch\s*\(/g,
    /\?\s*[^:]+:/g,  // Ternary
    /\&\&/g,
    /\|\|/g,
    /\?\?/g
  ];

  for (const pattern of patterns) {
    const matches = content.match(pattern);
    if (matches) cyclomatic += matches.length;
  }

  // Count nested structures for cognitive complexity
  const nestingPatterns = [
    /\bif\s*\(/g,
    /\bfor\s*\(/g,
    /\bwhile\s*\(/g,
    /\.map\s*\(/g,
    /\.filter\s*\(/g,
    /\.reduce\s*\(/g
  ];

  for (const pattern of nestingPatterns) {
    const matches = content.match(pattern);
    if (matches) cognitive += matches.length;
  }

  // Count functions
  const funcPatterns = [
    /function\s+\w+\s*\(/g,
    /(?:const|let|var)\s+\w+\s*=\s*(?:async\s*)?\(/g,
    /(?:const|let|var)\s+\w+\s*=\s*(?:async\s*)?\w+\s*=>/g,
    /\w+\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*\{/g
  ];

  for (const pattern of funcPatterns) {
    const matches = content.match(pattern);
    if (matches) functions += matches.length;
  }

  return { cyclomatic, cognitive, functions };
}

function calculateDebtScore(content: string, complexity: FileMetrics['complexity'], loc: number): number {
  let debt = 0;

  // High complexity penalty
  if (complexity.cyclomatic > 20) debt += 20;
  else if (complexity.cyclomatic > 10) debt += 10;
  else if (complexity.cyclomatic > 5) debt += 5;

  // Long file penalty
  if (loc > 500) debt += 15;
  else if (loc > 300) debt += 10;
  else if (loc > 200) debt += 5;

  // TODO/FIXME comments
  const todos = content.match(/\/\/\s*(TODO|FIXME|HACK|XXX)/gi);
  if (todos) debt += todos.length * 2;

  // Console statements
  const consoles = content.match(/console\.(log|debug|info|warn|error)\(/g);
  if (consoles) debt += consoles.length;

  // Any type usage
  const anys = content.match(/:\s*any\b/g);
  if (anys) debt += anys.length * 3;

  // @ts-ignore
  const ignores = content.match(/@ts-ignore/g);
  if (ignores) debt += ignores.length * 5;

  return Math.min(100, debt);
}

async function generateLocReport(inputPath: string, options: MetricsArgs['options']): Promise<string> {
  const { exclude = [], format = 'summary', groupBy = 'language' } = options || {};
  const files = await getFiles(inputPath, exclude);

  const metrics = files
    .filter(f => Object.keys(LANGUAGE_MAP).some(ext => f.endsWith(ext)))
    .map(f => analyzeFile(f));

  if (format === 'json') {
    return JSON.stringify(metrics.map(m => ({ file: path.relative(process.cwd(), m.file), ...m.loc, language: m.language })), null, 2);
  }

  const output: string[] = [];
  output.push('=== Lines of Code Report ===');
  output.push('');

  if (groupBy === 'language') {
    const byLanguage = new Map<string, { code: number; comment: number; blank: number; files: number }>();

    for (const m of metrics) {
      const existing = byLanguage.get(m.language) || { code: 0, comment: 0, blank: 0, files: 0 };
      byLanguage.set(m.language, {
        code: existing.code + m.loc.code,
        comment: existing.comment + m.loc.comment,
        blank: existing.blank + m.loc.blank,
        files: existing.files + 1
      });
    }

    output.push('| Language | Files | Code | Comment | Blank | Total |');
    output.push('|----------|-------|------|---------|-------|-------|');

    const sorted = Array.from(byLanguage.entries()).sort((a, b) => b[1].code - a[1].code);
    for (const [lang, data] of sorted) {
      const total = data.code + data.comment + data.blank;
      output.push(`| ${lang.padEnd(10)} | ${String(data.files).padStart(5)} | ${String(data.code).padStart(4)} | ${String(data.comment).padStart(7)} | ${String(data.blank).padStart(5)} | ${String(total).padStart(5)} |`);
    }
  } else {
    for (const m of metrics) {
      const relPath = path.relative(process.cwd(), m.file);
      output.push(`${relPath}: ${m.loc.code} code, ${m.loc.comment} comment, ${m.loc.blank} blank`);
    }
  }

  output.push('');
  const totals = metrics.reduce((acc, m) => ({
    code: acc.code + m.loc.code,
    comment: acc.comment + m.loc.comment,
    blank: acc.blank + m.loc.blank,
    total: acc.total + m.loc.total
  }), { code: 0, comment: 0, blank: 0, total: 0 });

  output.push(`Total: ${totals.code} code, ${totals.comment} comment, ${totals.blank} blank (${totals.total} total lines in ${metrics.length} files)`);

  return output.join('\n');
}

async function generateComplexityReport(inputPath: string, options: MetricsArgs['options']): Promise<string> {
  const { exclude = [], format = 'summary' } = options || {};
  const files = await getFiles(inputPath, exclude);

  const codeExtensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.go', '.rs', '.c', '.cpp'];
  const metrics = files
    .filter(f => codeExtensions.some(ext => f.endsWith(ext)))
    .map(f => analyzeFile(f));

  if (format === 'json') {
    return JSON.stringify(metrics.map(m => ({
      file: path.relative(process.cwd(), m.file),
      ...m.complexity
    })), null, 2);
  }

  const output: string[] = [];
  output.push('=== Complexity Report ===');
  output.push('');

  // Sort by cyclomatic complexity
  const sorted = [...metrics].sort((a, b) => b.complexity.cyclomatic - a.complexity.cyclomatic);

  output.push('| File | Cyclomatic | Cognitive | Functions |');
  output.push('|------|------------|-----------|-----------|');

  for (const m of sorted.slice(0, 20)) {
    const relPath = path.relative(process.cwd(), m.file);
    const shortPath = relPath.length > 40 ? '...' + relPath.slice(-37) : relPath;
    const cc = m.complexity.cyclomatic;
    const marker = cc > 20 ? ' !' : cc > 10 ? ' *' : '';
    output.push(`| ${shortPath.padEnd(40)} | ${String(cc).padStart(10)}${marker} | ${String(m.complexity.cognitive).padStart(9)} | ${String(m.complexity.functions).padStart(9)} |`);
  }

  if (sorted.length > 20) {
    output.push(`| ... and ${sorted.length - 20} more files |`);
  }

  output.push('');
  output.push('Legend: ! = High complexity (>20), * = Moderate complexity (>10)');

  return output.join('\n');
}

async function generateDebtReport(inputPath: string, options: MetricsArgs['options']): Promise<string> {
  const { exclude = [], format = 'summary' } = options || {};
  const files = await getFiles(inputPath, exclude);

  const codeExtensions = ['.ts', '.tsx', '.js', '.jsx'];
  const metrics = files
    .filter(f => codeExtensions.some(ext => f.endsWith(ext)))
    .map(f => analyzeFile(f));

  if (format === 'json') {
    return JSON.stringify(metrics.map(m => ({
      file: path.relative(process.cwd(), m.file),
      debtScore: m.debtScore
    })), null, 2);
  }

  const output: string[] = [];
  output.push('=== Technical Debt Report ===');
  output.push('');

  const sorted = [...metrics].sort((a, b) => b.debtScore - a.debtScore);
  const highDebt = sorted.filter(m => m.debtScore > 30);

  output.push(`Files analyzed: ${metrics.length}`);
  output.push(`High debt files (>30): ${highDebt.length}`);
  output.push('');

  if (highDebt.length > 0) {
    output.push('High Debt Files:');
    for (const m of highDebt.slice(0, 15)) {
      const relPath = path.relative(process.cwd(), m.file);
      const bar = '█'.repeat(Math.ceil(m.debtScore / 10));
      output.push(`  ${m.debtScore.toString().padStart(3)} ${bar} ${relPath}`);
    }
    output.push('');
  }

  const avgDebt = metrics.reduce((sum, m) => sum + m.debtScore, 0) / metrics.length;
  output.push(`Average debt score: ${avgDebt.toFixed(1)}`);
  output.push('');
  output.push('Debt Score Guide:');
  output.push('  0-10: Low debt - well maintained');
  output.push('  10-30: Moderate debt - could use improvement');
  output.push('  30-50: High debt - needs attention');
  output.push('  50+: Critical debt - prioritize refactoring');

  return output.join('\n');
}

async function generateMaintainabilityReport(inputPath: string, options: MetricsArgs['options']): Promise<string> {
  const { exclude = [], format = 'summary' } = options || {};
  const files = await getFiles(inputPath, exclude);

  const codeExtensions = ['.ts', '.tsx', '.js', '.jsx'];
  const metrics = files
    .filter(f => codeExtensions.some(ext => f.endsWith(ext)))
    .map(f => analyzeFile(f));

  if (format === 'json') {
    return JSON.stringify(metrics.map(m => ({
      file: path.relative(process.cwd(), m.file),
      maintainability: m.maintainability
    })), null, 2);
  }

  const output: string[] = [];
  output.push('=== Maintainability Report ===');
  output.push('');

  const sorted = [...metrics].sort((a, b) => a.maintainability - b.maintainability);

  output.push('Least Maintainable Files:');
  for (const m of sorted.slice(0, 10)) {
    const relPath = path.relative(process.cwd(), m.file);
    const rating = m.maintainability >= 60 ? '✓' : m.maintainability >= 30 ? '~' : '✗';
    output.push(`  ${rating} ${m.maintainability.toString().padStart(3)} ${relPath}`);
  }

  output.push('');

  const avgMI = metrics.reduce((sum, m) => sum + m.maintainability, 0) / metrics.length;
  output.push(`Average Maintainability Index: ${avgMI.toFixed(1)}`);
  output.push('');
  output.push('Index Guide:');
  output.push('  60-100: Highly maintainable');
  output.push('  30-60:  Moderately maintainable');
  output.push('  0-30:   Difficult to maintain');

  return output.join('\n');
}

async function generateFullReport(inputPath: string, options: MetricsArgs['options']): Promise<string> {
  const { exclude = [] } = options || {};

  const output: string[] = [];
  output.push('=== Full Code Metrics Report ===');
  output.push('');

  output.push(await generateLocReport(inputPath, { exclude, format: 'summary', groupBy: 'language' }));
  output.push('');
  output.push(await generateComplexityReport(inputPath, { exclude, format: 'summary' }));
  output.push('');
  output.push(await generateDebtReport(inputPath, { exclude, format: 'summary' }));
  output.push('');
  output.push(await generateMaintainabilityReport(inputPath, { exclude, format: 'summary' }));

  return output.join('\n');
}
