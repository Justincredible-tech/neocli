/* NEO_SKILL_META
{
  "name": "type_safety_analyzer",
  "description": "Analyzes TypeScript code for type safety issues: implicit any, type assertion abuse, missing return types, strict mode violations, and provides recommendations.",
  "argsSchema": {
    "type": "object",
    "properties": {
      "filePath": { "type": "string", "description": "Path to TypeScript file to analyze" },
      "checks": {
        "type": "array",
        "items": {
          "type": "string",
          "enum": ["implicit_any", "type_assertions", "missing_return_types", "null_checks", "strict_mode", "all"]
        },
        "description": "Checks to perform (default: all)"
      },
      "strictLevel": {
        "type": "string",
        "enum": ["lenient", "moderate", "strict"],
        "description": "Strictness level for analysis (default: moderate)"
      }
    },
    "required": ["filePath"]
  }
}
NEO_SKILL_META */

import fs from 'fs';
import path from 'path';

interface TypeIssue {
  type: string;
  severity: 'error' | 'warning' | 'info';
  line: number;
  column?: number;
  message: string;
  suggestion?: string;
}

interface AnalysisResult {
  file: string;
  issues: TypeIssue[];
  score: number;
  summary: {
    errors: number;
    warnings: number;
    info: number;
  };
  recommendations: string[];
}

interface AnalyzeArgs {
  filePath: string;
  checks?: ('implicit_any' | 'type_assertions' | 'missing_return_types' | 'null_checks' | 'strict_mode' | 'all')[];
  strictLevel?: 'lenient' | 'moderate' | 'strict';
}

export async function run(args: AnalyzeArgs): Promise<string> {
  const { filePath, checks = ['all'], strictLevel = 'moderate' } = args;

  if (!filePath) {
    return 'Error: filePath is required';
  }

  const absPath = path.resolve(process.cwd(), filePath);

  if (!fs.existsSync(absPath)) {
    return `Error: File not found: ${absPath}`;
  }

  const ext = path.extname(absPath).toLowerCase();
  if (ext !== '.ts' && ext !== '.tsx') {
    return `Error: Not a TypeScript file: ${ext}. Expected .ts or .tsx`;
  }

  try {
    const content = fs.readFileSync(absPath, 'utf-8');
    const lines = content.split('\n');

    const result: AnalysisResult = {
      file: filePath,
      issues: [],
      score: 100,
      summary: { errors: 0, warnings: 0, info: 0 },
      recommendations: []
    };

    const runAll = checks.includes('all');

    // Check for implicit any
    if (runAll || checks.includes('implicit_any')) {
      analyzeImplicitAny(content, lines, result, strictLevel);
    }

    // Check for type assertions
    if (runAll || checks.includes('type_assertions')) {
      analyzeTypeAssertions(content, lines, result, strictLevel);
    }

    // Check for missing return types
    if (runAll || checks.includes('missing_return_types')) {
      analyzeMissingReturnTypes(content, lines, result, strictLevel);
    }

    // Check for null/undefined handling
    if (runAll || checks.includes('null_checks')) {
      analyzeNullChecks(content, lines, result, strictLevel);
    }

    // Check strict mode compliance
    if (runAll || checks.includes('strict_mode')) {
      analyzeStrictMode(content, lines, result, strictLevel);
    }

    // Calculate score
    for (const issue of result.issues) {
      switch (issue.severity) {
        case 'error':
          result.score -= 10;
          result.summary.errors++;
          break;
        case 'warning':
          result.score -= 3;
          result.summary.warnings++;
          break;
        case 'info':
          result.score -= 1;
          result.summary.info++;
          break;
      }
    }
    result.score = Math.max(0, result.score);

    // Generate recommendations
    generateRecommendations(result);

    // Format output
    return formatOutput(result);

  } catch (e: unknown) {
    return `Error analyzing file: ${(e as Error).message}`;
  }
}

function analyzeImplicitAny(content: string, lines: string[], result: AnalysisResult, level: string): void {
  // Check function parameters without types
  const paramRegex = /(?:function\s+\w+|\w+\s*[=:]\s*(?:async\s*)?\(|(?:async\s+)?)\(([^)]+)\)/g;
  let match;

  while ((match = paramRegex.exec(content)) !== null) {
    const params = match[1];
    const lineNum = content.substring(0, match.index).split('\n').length;

    // Split parameters and check each
    const paramList = params.split(',');
    for (const param of paramList) {
      const trimmed = param.trim();
      if (!trimmed) continue;

      // Check if parameter has type annotation
      if (!trimmed.includes(':') && !trimmed.startsWith('...')) {
        // Skip destructured params with type annotation after
        if (!params.includes(': {') && !params.includes(': [')) {
          result.issues.push({
            type: 'implicit_any',
            severity: level === 'strict' ? 'error' : 'warning',
            line: lineNum,
            message: `Parameter "${trimmed.split('=')[0].trim()}" has implicit 'any' type`,
            suggestion: `Add explicit type annotation: ${trimmed.split('=')[0].trim()}: SomeType`
          });
        }
      }
    }
  }

  // Check variable declarations without types and initializers
  const varRegex = /(?:let|var)\s+(\w+)\s*;/g;
  while ((match = varRegex.exec(content)) !== null) {
    const lineNum = content.substring(0, match.index).split('\n').length;
    result.issues.push({
      type: 'implicit_any',
      severity: level === 'strict' ? 'error' : 'warning',
      line: lineNum,
      message: `Variable "${match[1]}" declared without type or initializer (implicit any)`,
      suggestion: `Add type annotation: let ${match[1]}: Type;`
    });
  }

  // Check catch clause parameters
  const catchRegex = /catch\s*\(\s*(\w+)\s*\)/g;
  while ((match = catchRegex.exec(content)) !== null) {
    const lineNum = content.substring(0, match.index).split('\n').length;
    if (level !== 'lenient') {
      result.issues.push({
        type: 'implicit_any',
        severity: 'info',
        line: lineNum,
        message: `Catch clause parameter "${match[1]}" is implicitly 'unknown' or 'any'`,
        suggestion: `Consider: catch (${match[1]}: unknown) and narrow the type`
      });
    }
  }
}

function analyzeTypeAssertions(content: string, lines: string[], result: AnalysisResult, level: string): void {
  // Check for 'as any' assertions
  const asAnyRegex = /as\s+any\b/g;
  let match;

  while ((match = asAnyRegex.exec(content)) !== null) {
    const lineNum = content.substring(0, match.index).split('\n').length;
    result.issues.push({
      type: 'type_assertion',
      severity: 'error',
      line: lineNum,
      message: `Type assertion 'as any' bypasses type safety`,
      suggestion: `Use proper type narrowing or a more specific type assertion`
    });
  }

  // Check for 'as unknown as X' pattern (double assertion)
  const doubleAssertRegex = /as\s+unknown\s+as\s+\w+/g;
  while ((match = doubleAssertRegex.exec(content)) !== null) {
    const lineNum = content.substring(0, match.index).split('\n').length;
    result.issues.push({
      type: 'type_assertion',
      severity: 'warning',
      line: lineNum,
      message: `Double type assertion may indicate type system bypass`,
      suggestion: `Review if the type conversion is truly necessary`
    });
  }

  // Check for non-null assertions
  const nonNullRegex = /\w+!/g;
  let nonNullCount = 0;
  while ((match = nonNullRegex.exec(content)) !== null) {
    // Skip !== and != operators
    const nextChar = content[match.index + match[0].length];
    if (nextChar === '=' || nextChar === '!') continue;

    // Skip template literals
    const prevContent = content.substring(0, match.index);
    if (prevContent.lastIndexOf('`') > prevContent.lastIndexOf('${')) continue;

    nonNullCount++;
    if (level === 'strict') {
      const lineNum = content.substring(0, match.index).split('\n').length;
      result.issues.push({
        type: 'type_assertion',
        severity: 'warning',
        line: lineNum,
        message: `Non-null assertion (!) used`,
        suggestion: `Consider null check or optional chaining (?.) instead`
      });
    }
  }

  if (nonNullCount > 5 && level !== 'lenient') {
    result.issues.push({
      type: 'type_assertion',
      severity: 'info',
      line: 0,
      message: `Found ${nonNullCount} non-null assertions (!). Consider reducing reliance on them.`
    });
  }
}

function analyzeMissingReturnTypes(content: string, lines: string[], result: AnalysisResult, level: string): void {
  // Check exported functions without return types
  const funcRegex = /export\s+(?:async\s+)?function\s+(\w+)\s*\([^)]*\)\s*\{/g;
  let match;

  while ((match = funcRegex.exec(content)) !== null) {
    const lineNum = content.substring(0, match.index).split('\n').length;
    const beforeBrace = content.substring(match.index, match.index + match[0].length - 1);

    if (!beforeBrace.includes('):')) {
      result.issues.push({
        type: 'missing_return_type',
        severity: level === 'strict' ? 'error' : 'warning',
        line: lineNum,
        message: `Exported function "${match[1]}" has no explicit return type`,
        suggestion: `Add return type: function ${match[1]}(...): ReturnType`
      });
    }
  }

  // Check exported arrow functions
  const arrowRegex = /export\s+const\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g;
  while ((match = arrowRegex.exec(content)) !== null) {
    const lineNum = content.substring(0, match.index).split('\n').length;
    const snippet = content.substring(match.index, match.index + match[0].length);

    if (!snippet.includes('):')) {
      result.issues.push({
        type: 'missing_return_type',
        severity: level === 'strict' ? 'error' : 'warning',
        line: lineNum,
        message: `Exported arrow function "${match[1]}" has no explicit return type`,
        suggestion: `Add return type annotation after parameters`
      });
    }
  }

  // Check class methods (public by default)
  if (level === 'strict') {
    const methodRegex = /^\s*(?:async\s+)?(\w+)\s*\([^)]*\)\s*\{/gm;
    while ((match = methodRegex.exec(content)) !== null) {
      if (match[1] === 'constructor' || match[1] === 'if' || match[1] === 'for' || match[1] === 'while') continue;

      const lineNum = content.substring(0, match.index).split('\n').length;
      const snippet = content.substring(match.index, match.index + match[0].length);

      if (!snippet.includes('):')) {
        result.issues.push({
          type: 'missing_return_type',
          severity: 'info',
          line: lineNum,
          message: `Method "${match[1]}" has no explicit return type`,
          suggestion: `Consider adding return type for clarity`
        });
      }
    }
  }
}

function analyzeNullChecks(content: string, lines: string[], result: AnalysisResult, level: string): void {
  // Check for == null comparisons (should use === or == with strict null checks)
  const looseNullRegex = /[^!=]==?\s*null\b/g;
  let match;

  while ((match = looseNullRegex.exec(content)) !== null) {
    if (content[match.index] !== '=' && content[match.index] !== '!') {
      const lineNum = content.substring(0, match.index).split('\n').length;
      if (level !== 'lenient') {
        result.issues.push({
          type: 'null_check',
          severity: 'info',
          line: lineNum,
          message: `Consider using strict equality (===) for null checks`,
          suggestion: `Use === null or !== null for explicit null checks`
        });
      }
    }
  }

  // Check for direct property access on optional types (potential null access)
  const optionalAccessRegex = /(\w+)\?\.\w+\(\)\.(\w+)/g;
  while ((match = optionalAccessRegex.exec(content)) !== null) {
    const lineNum = content.substring(0, match.index).split('\n').length;
    result.issues.push({
      type: 'null_check',
      severity: 'warning',
      line: lineNum,
      message: `Potential null access after optional chain result`,
      suggestion: `Chain may return undefined - ensure property "${match[2]}" access is safe`
    });
  }
}

function analyzeStrictMode(content: string, lines: string[], result: AnalysisResult, level: string): void {
  // Check for @ts-ignore comments
  const tsIgnoreRegex = /@ts-ignore/g;
  let match;
  let ignoreCount = 0;

  while ((match = tsIgnoreRegex.exec(content)) !== null) {
    ignoreCount++;
    const lineNum = content.substring(0, match.index).split('\n').length;
    result.issues.push({
      type: 'strict_mode',
      severity: 'warning',
      line: lineNum,
      message: `@ts-ignore suppresses TypeScript errors`,
      suggestion: `Fix the underlying type issue instead of ignoring it`
    });
  }

  // Check for @ts-expect-error (slightly better than ignore)
  const tsExpectRegex = /@ts-expect-error/g;
  while ((match = tsExpectRegex.exec(content)) !== null) {
    if (level === 'strict') {
      const lineNum = content.substring(0, match.index).split('\n').length;
      result.issues.push({
        type: 'strict_mode',
        severity: 'info',
        line: lineNum,
        message: `@ts-expect-error used - ensure this is intentional`,
        suggestion: `Document why this suppression is necessary`
      });
    }
  }

  // Check for 'any' type usage
  const anyTypeRegex = /:\s*any\b/g;
  let anyCount = 0;
  while ((match = anyTypeRegex.exec(content)) !== null) {
    anyCount++;
    if (level === 'strict') {
      const lineNum = content.substring(0, match.index).split('\n').length;
      result.issues.push({
        type: 'strict_mode',
        severity: 'warning',
        line: lineNum,
        message: `Explicit 'any' type used`,
        suggestion: `Replace with 'unknown' or a more specific type`
      });
    }
  }

  if (anyCount > 0 && level !== 'strict') {
    result.issues.push({
      type: 'strict_mode',
      severity: anyCount > 5 ? 'warning' : 'info',
      line: 0,
      message: `Found ${anyCount} explicit 'any' type annotations`
    });
  }
}

function generateRecommendations(result: AnalysisResult): void {
  const issueCounts: Record<string, number> = {};

  for (const issue of result.issues) {
    issueCounts[issue.type] = (issueCounts[issue.type] || 0) + 1;
  }

  if (issueCounts['implicit_any'] > 3) {
    result.recommendations.push('Enable "noImplicitAny" in tsconfig.json to catch untyped parameters');
  }

  if (issueCounts['type_assertion'] > 3) {
    result.recommendations.push('Review type assertions - prefer type guards and proper narrowing');
  }

  if (issueCounts['missing_return_type'] > 3) {
    result.recommendations.push('Enable "noImplicitReturns" and add explicit return types to functions');
  }

  if (issueCounts['null_check'] > 2) {
    result.recommendations.push('Enable "strictNullChecks" in tsconfig.json for better null safety');
  }

  if (issueCounts['strict_mode'] > 2) {
    result.recommendations.push('Enable "strict" mode in tsconfig.json for maximum type safety');
  }

  if (result.score >= 90) {
    result.recommendations.push('Good type safety! Consider enabling stricter compiler options.');
  } else if (result.score < 50) {
    result.recommendations.push('Consider a gradual migration to stricter types using // @ts-check in JS files');
  }
}

function formatOutput(result: AnalysisResult): string {
  const lines: string[] = [];

  lines.push(`Type Safety Analysis: ${result.file}`);
  lines.push(`Score: ${result.score}/100`);
  lines.push(`Summary: ${result.summary.errors} errors, ${result.summary.warnings} warnings, ${result.summary.info} info`);
  lines.push('');

  if (result.issues.length === 0) {
    lines.push('No issues found!');
  } else {
    lines.push('=== Issues ===');
    for (const issue of result.issues) {
      const prefix = issue.severity === 'error' ? '!' : issue.severity === 'warning' ? '*' : '-';
      const location = issue.line > 0 ? ` (line ${issue.line})` : '';
      lines.push(`${prefix} [${issue.type}]${location}: ${issue.message}`);
      if (issue.suggestion) {
        lines.push(`  -> ${issue.suggestion}`);
      }
    }
  }

  if (result.recommendations.length > 0) {
    lines.push('');
    lines.push('=== Recommendations ===');
    for (const rec of result.recommendations) {
      lines.push(`• ${rec}`);
    }
  }

  return lines.join('\n');
}
