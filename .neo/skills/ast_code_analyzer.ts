/* NEO_SKILL_META
{
  "name": "ast_code_analyzer",
  "description": "Analyzes JavaScript/TypeScript code structure by parsing to AST. Extracts functions, classes, imports, exports, complexity metrics, and detects potential issues like dead code.",
  "argsSchema": {
    "type": "object",
    "properties": {
      "filePath": { "type": "string", "description": "Path to JS/TS file to analyze" },
      "analysis": {
        "type": "string",
        "enum": ["full", "functions", "classes", "imports", "exports", "complexity", "structure"],
        "description": "Type of analysis to perform (default: full)"
      },
      "includeLineNumbers": { "type": "boolean", "description": "Include line numbers in output (default: true)" }
    },
    "required": ["filePath"]
  }
}
NEO_SKILL_META */

import fs from 'fs';
import path from 'path';

interface FunctionInfo {
  name: string;
  type: 'function' | 'arrow' | 'method' | 'constructor';
  params: string[];
  async: boolean;
  exported: boolean;
  line: number;
  complexity: number;
}

interface ClassInfo {
  name: string;
  extends?: string;
  implements?: string[];
  methods: string[];
  properties: string[];
  exported: boolean;
  line: number;
}

interface ImportInfo {
  source: string;
  specifiers: string[];
  type: 'default' | 'named' | 'namespace' | 'side-effect';
  line: number;
}

interface ExportInfo {
  name: string;
  type: 'default' | 'named' | 'namespace' | 're-export';
  line: number;
}

interface AnalysisResult {
  file: string;
  language: 'javascript' | 'typescript';
  lines: number;
  functions: FunctionInfo[];
  classes: ClassInfo[];
  imports: ImportInfo[];
  exports: ExportInfo[];
  complexity: {
    total: number;
    average: number;
    highest: { name: string; value: number } | null;
  };
  issues: string[];
}

interface AnalyzeArgs {
  filePath: string;
  analysis?: 'full' | 'functions' | 'classes' | 'imports' | 'exports' | 'complexity' | 'structure';
  includeLineNumbers?: boolean;
}

// Simple regex-based parser (works without external AST libraries)
function parseCode(content: string, isTS: boolean): AnalysisResult {
  const lines = content.split('\n');
  const result: AnalysisResult = {
    file: '',
    language: isTS ? 'typescript' : 'javascript',
    lines: lines.length,
    functions: [],
    classes: [],
    imports: [],
    exports: [],
    complexity: { total: 0, average: 0, highest: null },
    issues: []
  };

  // Parse imports
  const importRegex = /^import\s+(?:(?:(\w+)(?:\s*,\s*)?)?(?:\{([^}]+)\})?(?:\*\s+as\s+(\w+))?)\s*from\s*['"]([^'"]+)['"]/gm;
  const sideEffectImport = /^import\s+['"]([^'"]+)['"]/gm;

  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const lineNum = content.substring(0, match.index).split('\n').length;
    const specifiers: string[] = [];
    let type: 'default' | 'named' | 'namespace' = 'named';

    if (match[1]) { // default import
      specifiers.push(match[1]);
      type = 'default';
    }
    if (match[2]) { // named imports
      specifiers.push(...match[2].split(',').map(s => s.trim().split(/\s+as\s+/)[0]));
    }
    if (match[3]) { // namespace import
      specifiers.push(match[3]);
      type = 'namespace';
    }

    result.imports.push({
      source: match[4],
      specifiers,
      type,
      line: lineNum
    });
  }

  while ((match = sideEffectImport.exec(content)) !== null) {
    if (!content.substring(match.index).match(/^import\s+[\w{*]/)) {
      const lineNum = content.substring(0, match.index).split('\n').length;
      result.imports.push({
        source: match[1],
        specifiers: [],
        type: 'side-effect',
        line: lineNum
      });
    }
  }

  // Parse functions
  const functionPatterns = [
    // Regular functions
    /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/g,
    // Arrow functions assigned to const/let/var
    /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*(?::\s*[^=]+)?\s*=>/g,
    // Arrow functions assigned (simple params)
    /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(\w+)\s*=>/g
  ];

  for (const pattern of functionPatterns) {
    while ((match = pattern.exec(content)) !== null) {
      const lineNum = content.substring(0, match.index).split('\n').length;
      const fullMatch = match[0];
      const name = match[1];
      const paramsStr = match[2] || '';

      // Calculate complexity for this function
      const funcEnd = findBlockEnd(content, match.index);
      const funcBody = content.substring(match.index, funcEnd);
      const complexity = calculateComplexity(funcBody);

      result.functions.push({
        name,
        type: fullMatch.includes('=>') ? 'arrow' : 'function',
        params: paramsStr.split(',').map(p => p.trim().split(':')[0].split('=')[0].trim()).filter(p => p),
        async: fullMatch.includes('async'),
        exported: fullMatch.includes('export'),
        line: lineNum,
        complexity
      });
    }
  }

  // Parse classes
  const classRegex = /(?:export\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([^{]+))?\s*\{/g;

  while ((match = classRegex.exec(content)) !== null) {
    const lineNum = content.substring(0, match.index).split('\n').length;
    const classEnd = findBlockEnd(content, match.index + match[0].length - 1);
    const classBody = content.substring(match.index, classEnd);

    // Find methods in class
    const methodRegex = /(?:async\s+)?(\w+)\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*\{/g;
    const methods: string[] = [];
    const properties: string[] = [];
    let methodMatch;

    while ((methodMatch = methodRegex.exec(classBody)) !== null) {
      methods.push(methodMatch[1]);
    }

    // Find properties
    const propRegex = /(?:private|public|protected|readonly)?\s*(\w+)\s*[?:]?\s*[:=]/g;
    while ((methodMatch = propRegex.exec(classBody)) !== null) {
      if (!methods.includes(methodMatch[1]) && methodMatch[1] !== 'constructor') {
        properties.push(methodMatch[1]);
      }
    }

    result.classes.push({
      name: match[1],
      extends: match[2] || undefined,
      implements: match[3] ? match[3].split(',').map(s => s.trim()) : undefined,
      methods: [...new Set(methods)],
      properties: [...new Set(properties)],
      exported: match[0].includes('export'),
      line: lineNum
    });
  }

  // Parse exports
  const exportPatterns = [
    /export\s+default\s+(?:class|function|const|let|var)?\s*(\w+)?/g,
    /export\s+\{([^}]+)\}/g,
    /export\s+\*\s+from\s+['"]([^'"]+)['"]/g
  ];

  // Default exports
  const defaultExportRegex = /export\s+default\s+(?:class|function|const|let|var)?\s*(\w+)?/g;
  while ((match = defaultExportRegex.exec(content)) !== null) {
    const lineNum = content.substring(0, match.index).split('\n').length;
    result.exports.push({
      name: match[1] || 'default',
      type: 'default',
      line: lineNum
    });
  }

  // Named exports
  const namedExportRegex = /export\s+\{([^}]+)\}/g;
  while ((match = namedExportRegex.exec(content)) !== null) {
    const lineNum = content.substring(0, match.index).split('\n').length;
    const names = match[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0]);
    for (const name of names) {
      result.exports.push({ name, type: 'named', line: lineNum });
    }
  }

  // Re-exports
  const reExportRegex = /export\s+\*\s+from\s+['"]([^'"]+)['"]/g;
  while ((match = reExportRegex.exec(content)) !== null) {
    const lineNum = content.substring(0, match.index).split('\n').length;
    result.exports.push({
      name: `* from ${match[1]}`,
      type: 're-export',
      line: lineNum
    });
  }

  // Calculate overall complexity
  if (result.functions.length > 0) {
    result.complexity.total = result.functions.reduce((sum, f) => sum + f.complexity, 0);
    result.complexity.average = Math.round(result.complexity.total / result.functions.length * 10) / 10;

    const highest = result.functions.reduce((max, f) => f.complexity > max.complexity ? f : max, result.functions[0]);
    result.complexity.highest = { name: highest.name, value: highest.complexity };
  }

  // Detect issues
  detectIssues(result, content);

  return result;
}

function findBlockEnd(content: string, startIndex: number): number {
  let depth = 0;
  let inString = false;
  let stringChar = '';

  for (let i = startIndex; i < content.length; i++) {
    const char = content[i];
    const prevChar = content[i - 1];

    // Handle strings
    if ((char === '"' || char === "'" || char === '`') && prevChar !== '\\') {
      if (!inString) {
        inString = true;
        stringChar = char;
      } else if (char === stringChar) {
        inString = false;
      }
      continue;
    }

    if (inString) continue;

    if (char === '{') depth++;
    if (char === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }

  return content.length;
}

function calculateComplexity(code: string): number {
  // Cyclomatic complexity estimation
  let complexity = 1;

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
    const matches = code.match(pattern);
    if (matches) complexity += matches.length;
  }

  return complexity;
}

function detectIssues(result: AnalysisResult, content: string): void {
  // Check for unused imports (simple check)
  for (const imp of result.imports) {
    for (const spec of imp.specifiers) {
      const usageRegex = new RegExp(`\\b${spec}\\b`, 'g');
      const matches = content.match(usageRegex);
      // If only found once (the import itself), might be unused
      if (matches && matches.length <= 1) {
        result.issues.push(`Potentially unused import: ${spec} from "${imp.source}" (line ${imp.line})`);
      }
    }
  }

  // Check for high complexity functions
  for (const func of result.functions) {
    if (func.complexity > 10) {
      result.issues.push(`High complexity function: ${func.name} (complexity: ${func.complexity}, line ${func.line})`);
    }
  }

  // Check for very long functions (rough estimate)
  const funcRegex = /(?:function|=>)\s*[^{]*\{/g;
  let match;
  while ((match = funcRegex.exec(content)) !== null) {
    const blockEnd = findBlockEnd(content, match.index);
    const funcContent = content.substring(match.index, blockEnd);
    const lineCount = funcContent.split('\n').length;
    if (lineCount > 50) {
      const lineNum = content.substring(0, match.index).split('\n').length;
      result.issues.push(`Long function at line ${lineNum} (${lineCount} lines)`);
    }
  }

  // Check for console.log statements
  const consoleMatches = content.match(/console\.(log|debug|info|warn|error)\(/g);
  if (consoleMatches && consoleMatches.length > 0) {
    result.issues.push(`Found ${consoleMatches.length} console statement(s)`);
  }

  // Check for TODO/FIXME comments
  const todoMatches = content.match(/\/\/\s*(TODO|FIXME|HACK|XXX)[:\s]/gi);
  if (todoMatches && todoMatches.length > 0) {
    result.issues.push(`Found ${todoMatches.length} TODO/FIXME comment(s)`);
  }
}

export async function run(args: AnalyzeArgs): Promise<string> {
  const { filePath, analysis = 'full', includeLineNumbers = true } = args;

  if (!filePath) {
    return 'Error: filePath is required';
  }

  const absPath = path.resolve(process.cwd(), filePath);

  if (!fs.existsSync(absPath)) {
    return `Error: File not found: ${absPath}`;
  }

  const ext = path.extname(absPath).toLowerCase();
  if (!['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'].includes(ext)) {
    return `Error: Unsupported file type: ${ext}. Supported: .js, .jsx, .ts, .tsx, .mjs, .cjs`;
  }

  try {
    const content = fs.readFileSync(absPath, 'utf-8');
    const isTS = ext === '.ts' || ext === '.tsx';
    const result = parseCode(content, isTS);
    result.file = filePath;

    // Format output based on analysis type
    const output: string[] = [`Analysis of ${filePath}`, `Language: ${result.language}`, `Lines: ${result.lines}`, ''];

    if (analysis === 'full' || analysis === 'imports') {
      output.push(`=== Imports (${result.imports.length}) ===`);
      for (const imp of result.imports) {
        const line = includeLineNumbers ? ` (line ${imp.line})` : '';
        output.push(`  ${imp.type}: ${imp.specifiers.join(', ') || '(side-effect)'} from "${imp.source}"${line}`);
      }
      output.push('');
    }

    if (analysis === 'full' || analysis === 'exports') {
      output.push(`=== Exports (${result.exports.length}) ===`);
      for (const exp of result.exports) {
        const line = includeLineNumbers ? ` (line ${exp.line})` : '';
        output.push(`  ${exp.type}: ${exp.name}${line}`);
      }
      output.push('');
    }

    if (analysis === 'full' || analysis === 'functions') {
      output.push(`=== Functions (${result.functions.length}) ===`);
      for (const func of result.functions) {
        const line = includeLineNumbers ? ` (line ${func.line})` : '';
        const prefix = func.exported ? 'export ' : '';
        const asyncPrefix = func.async ? 'async ' : '';
        output.push(`  ${prefix}${asyncPrefix}${func.type} ${func.name}(${func.params.join(', ')}) [complexity: ${func.complexity}]${line}`);
      }
      output.push('');
    }

    if (analysis === 'full' || analysis === 'classes') {
      output.push(`=== Classes (${result.classes.length}) ===`);
      for (const cls of result.classes) {
        const line = includeLineNumbers ? ` (line ${cls.line})` : '';
        const prefix = cls.exported ? 'export ' : '';
        const ext = cls.extends ? ` extends ${cls.extends}` : '';
        output.push(`  ${prefix}class ${cls.name}${ext}${line}`);
        if (cls.methods.length > 0) {
          output.push(`    Methods: ${cls.methods.join(', ')}`);
        }
        if (cls.properties.length > 0) {
          output.push(`    Properties: ${cls.properties.join(', ')}`);
        }
      }
      output.push('');
    }

    if (analysis === 'full' || analysis === 'complexity') {
      output.push('=== Complexity Metrics ===');
      output.push(`  Total: ${result.complexity.total}`);
      output.push(`  Average: ${result.complexity.average}`);
      if (result.complexity.highest) {
        output.push(`  Highest: ${result.complexity.highest.name} (${result.complexity.highest.value})`);
      }
      output.push('');
    }

    if (analysis === 'full' && result.issues.length > 0) {
      output.push(`=== Issues Found (${result.issues.length}) ===`);
      for (const issue of result.issues) {
        output.push(`  ! ${issue}`);
      }
    }

    return output.join('\n');

  } catch (e: unknown) {
    return `Error analyzing file: ${(e as Error).message}`;
  }
}
