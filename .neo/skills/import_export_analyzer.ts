/* NEO_SKILL_META
{
  "name": "import_export_analyzer",
  "description": "Analyze import/export relationships in JavaScript/TypeScript projects. Maps dependencies, finds unused imports, detects circular dependencies.",
  "argsSchema": {
    "type": "object",
    "properties": {
      "action": {
        "type": "string",
        "enum": ["map", "unused", "circular", "summary"],
        "description": "Analysis action to perform"
      },
      "path": { "type": "string", "description": "File or directory to analyze" },
      "options": {
        "type": "object",
        "properties": {
          "depth": { "type": "number", "description": "Max depth for circular detection (default: 10)" },
          "includeNodeModules": { "type": "boolean", "description": "Include node_modules imports (default: false)" }
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

interface AnalyzerArgs {
  action: 'map' | 'unused' | 'circular' | 'summary';
  path: string;
  options?: {
    depth?: number;
    includeNodeModules?: boolean;
  };
}

interface ImportInfo {
  source: string;
  specifiers: string[];
  isDefault: boolean;
  isNamespace: boolean;
  line: number;
}

interface FileAnalysis {
  file: string;
  imports: ImportInfo[];
  exports: string[];
  reExports: string[];
}

export async function run(args: AnalyzerArgs): Promise<string> {
  const { action, path: inputPath, options = {} } = args;

  if (!action || !inputPath) {
    return 'Error: action and path are required';
  }

  try {
    switch (action) {
      case 'map':
        return mapDependencies(inputPath, options);
      case 'unused':
        return findUnusedImports(inputPath, options);
      case 'circular':
        return detectCircular(inputPath, options);
      case 'summary':
        return generateSummary(inputPath, options);
      default:
        return `Error: Unknown action "${action}"`;
    }
  } catch (e: unknown) {
    return `Error: ${(e as Error).message}`;
  }
}

function analyzeFile(filePath: string): FileAnalysis {
  const content = fs.readFileSync(filePath, 'utf-8');
  const imports: ImportInfo[] = [];
  const exports: string[] = [];
  const reExports: string[] = [];

  // Parse imports
  const importRegex = /import\s+(?:(?:(\w+)(?:\s*,\s*)?)?(?:\{([^}]+)\})?(?:\*\s+as\s+(\w+))?)\s*from\s*['"]([^'"]+)['"]/g;
  const sideEffectImport = /import\s+['"]([^'"]+)['"]/g;

  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const lineNum = content.substring(0, match.index).split('\n').length;
    const specifiers: string[] = [];
    let isDefault = false;
    let isNamespace = false;

    if (match[1]) {
      specifiers.push(match[1]);
      isDefault = true;
    }
    if (match[2]) {
      specifiers.push(...match[2].split(',').map(s => s.trim().split(/\s+as\s+/)[0].trim()));
    }
    if (match[3]) {
      specifiers.push(match[3]);
      isNamespace = true;
    }

    imports.push({
      source: match[4],
      specifiers,
      isDefault,
      isNamespace,
      line: lineNum
    });
  }

  // Side effect imports
  while ((match = sideEffectImport.exec(content)) !== null) {
    if (!content.substring(match.index).match(/^import\s+[\w{*]/)) {
      const lineNum = content.substring(0, match.index).split('\n').length;
      imports.push({
        source: match[1],
        specifiers: [],
        isDefault: false,
        isNamespace: false,
        line: lineNum
      });
    }
  }

  // Parse exports
  const namedExportRegex = /export\s+(?:async\s+)?(?:function|class|interface|type|const|let|var|enum)\s+(\w+)/g;
  while ((match = namedExportRegex.exec(content)) !== null) {
    exports.push(match[1]);
  }

  // Export list
  const exportListRegex = /export\s+\{([^}]+)\}/g;
  while ((match = exportListRegex.exec(content)) !== null) {
    exports.push(...match[1].split(',').map(s => s.trim().split(/\s+as\s+/).pop()!.trim()));
  }

  // Default export
  if (/export\s+default/.test(content)) {
    exports.push('default');
  }

  // Re-exports
  const reExportRegex = /export\s+(?:\{([^}]+)\}|\*)\s+from\s+['"]([^'"]+)['"]/g;
  while ((match = reExportRegex.exec(content)) !== null) {
    reExports.push(match[2]);
  }

  return {
    file: filePath,
    imports,
    exports,
    reExports
  };
}

async function getFiles(inputPath: string): Promise<string[]> {
  const absPath = path.resolve(process.cwd(), inputPath);

  if (!fs.existsSync(absPath)) {
    throw new Error(`Path not found: ${absPath}`);
  }

  if (fs.statSync(absPath).isDirectory()) {
    return glob('**/*.{ts,js,tsx,jsx}', {
      cwd: absPath,
      absolute: true,
      ignore: ['**/node_modules/**', '**/dist/**', '**/build/**']
    });
  }

  return [absPath];
}

async function mapDependencies(inputPath: string, options: AnalyzerArgs['options']): Promise<string> {
  const { includeNodeModules = false } = options || {};
  const files = await getFiles(inputPath);

  const output: string[] = [];
  output.push('=== Dependency Map ===');
  output.push('');

  const allAnalyses: FileAnalysis[] = [];
  const dependencyGraph = new Map<string, Set<string>>();

  for (const file of files) {
    const analysis = analyzeFile(file);
    allAnalyses.push(analysis);

    const relFile = path.relative(process.cwd(), file);
    if (!dependencyGraph.has(relFile)) {
      dependencyGraph.set(relFile, new Set());
    }

    for (const imp of analysis.imports) {
      if (!includeNodeModules && !imp.source.startsWith('.')) continue;

      if (imp.source.startsWith('.')) {
        const resolved = resolveImport(file, imp.source);
        if (resolved) {
          dependencyGraph.get(relFile)!.add(path.relative(process.cwd(), resolved));
        }
      } else {
        dependencyGraph.get(relFile)!.add(imp.source);
      }
    }
  }

  // Output graph
  for (const [file, deps] of dependencyGraph) {
    if (deps.size === 0) continue;

    output.push(`${file}`);
    for (const dep of deps) {
      output.push(`  └── ${dep}`);
    }
    output.push('');
  }

  output.push(`Total files: ${files.length}`);
  output.push(`Total dependencies: ${Array.from(dependencyGraph.values()).reduce((sum, s) => sum + s.size, 0)}`);

  return output.join('\n');
}

async function findUnusedImports(inputPath: string, options: AnalyzerArgs['options']): Promise<string> {
  const files = await getFiles(inputPath);

  const output: string[] = [];
  output.push('=== Unused Imports Analysis ===');
  output.push('');

  let totalUnused = 0;

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');
    const analysis = analyzeFile(file);
    const relFile = path.relative(process.cwd(), file);

    const unused: { name: string; line: number; source: string }[] = [];

    for (const imp of analysis.imports) {
      for (const spec of imp.specifiers) {
        // Check if the import is used in the file (excluding the import statement itself)
        const importLine = content.split('\n')[imp.line - 1];
        const restOfFile = content.replace(importLine, '');

        // Create a regex that matches the identifier as a whole word
        const usageRegex = new RegExp(`\\b${spec}\\b`, 'g');
        const matches = restOfFile.match(usageRegex);

        if (!matches || matches.length === 0) {
          unused.push({
            name: spec,
            line: imp.line,
            source: imp.source
          });
        }
      }
    }

    if (unused.length > 0) {
      output.push(`${relFile}:`);
      for (const u of unused) {
        output.push(`  Line ${u.line}: "${u.name}" from "${u.source}"`);
      }
      output.push('');
      totalUnused += unused.length;
    }
  }

  if (totalUnused === 0) {
    output.push('No unused imports found!');
  } else {
    output.push(`Total unused imports: ${totalUnused}`);
  }

  return output.join('\n');
}

async function detectCircular(inputPath: string, options: AnalyzerArgs['options']): Promise<string> {
  const { depth = 10 } = options || {};
  const files = await getFiles(inputPath);

  // Build dependency graph
  const graph = new Map<string, string[]>();

  for (const file of files) {
    const analysis = analyzeFile(file);
    const relFile = path.relative(process.cwd(), file);
    const deps: string[] = [];

    for (const imp of analysis.imports) {
      if (imp.source.startsWith('.')) {
        const resolved = resolveImport(file, imp.source);
        if (resolved) {
          deps.push(path.relative(process.cwd(), resolved));
        }
      }
    }

    graph.set(relFile, deps);
  }

  // Detect cycles using DFS
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const recursionStack = new Set<string>();

  function dfs(node: string, pathStack: string[]): void {
    if (pathStack.length > depth) return;

    if (recursionStack.has(node)) {
      // Found cycle
      const cycleStart = pathStack.indexOf(node);
      if (cycleStart !== -1) {
        cycles.push([...pathStack.slice(cycleStart), node]);
      }
      return;
    }

    if (visited.has(node)) return;

    visited.add(node);
    recursionStack.add(node);

    const neighbors = graph.get(node) || [];
    for (const neighbor of neighbors) {
      dfs(neighbor, [...pathStack, node]);
    }

    recursionStack.delete(node);
  }

  for (const node of graph.keys()) {
    visited.clear();
    recursionStack.clear();
    dfs(node, []);
  }

  const output: string[] = [];
  output.push('=== Circular Dependency Detection ===');
  output.push('');

  if (cycles.length === 0) {
    output.push('No circular dependencies found!');
  } else {
    // Deduplicate cycles
    const uniqueCycles = new Set<string>();
    const filteredCycles: string[][] = [];

    for (const cycle of cycles) {
      const normalized = [...cycle].sort().join(' -> ');
      if (!uniqueCycles.has(normalized)) {
        uniqueCycles.add(normalized);
        filteredCycles.push(cycle);
      }
    }

    output.push(`Found ${filteredCycles.length} circular dependency chain(s):`);
    output.push('');

    for (let i = 0; i < filteredCycles.length; i++) {
      const cycle = filteredCycles[i];
      output.push(`Cycle ${i + 1}:`);
      output.push(`  ${cycle.join(' -> ')}`);
      output.push('');
    }
  }

  return output.join('\n');
}

async function generateSummary(inputPath: string, options: AnalyzerArgs['options']): Promise<string> {
  const { includeNodeModules = false } = options || {};
  const files = await getFiles(inputPath);

  const stats = {
    totalFiles: files.length,
    totalImports: 0,
    totalExports: 0,
    externalDeps: new Set<string>(),
    internalDeps: 0,
    mostImported: new Map<string, number>(),
    mostExports: { file: '', count: 0 }
  };

  for (const file of files) {
    const analysis = analyzeFile(file);
    const relFile = path.relative(process.cwd(), file);

    stats.totalImports += analysis.imports.length;
    stats.totalExports += analysis.exports.length;

    if (analysis.exports.length > stats.mostExports.count) {
      stats.mostExports = { file: relFile, count: analysis.exports.length };
    }

    for (const imp of analysis.imports) {
      if (imp.source.startsWith('.')) {
        stats.internalDeps++;
        const resolved = resolveImport(file, imp.source);
        if (resolved) {
          const relResolved = path.relative(process.cwd(), resolved);
          stats.mostImported.set(relResolved, (stats.mostImported.get(relResolved) || 0) + 1);
        }
      } else {
        stats.externalDeps.add(imp.source.split('/')[0]);
      }
    }
  }

  // Sort most imported
  const sortedImported = Array.from(stats.mostImported.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  const output: string[] = [];
  output.push('=== Import/Export Summary ===');
  output.push('');
  output.push(`Total Files: ${stats.totalFiles}`);
  output.push(`Total Imports: ${stats.totalImports}`);
  output.push(`Total Exports: ${stats.totalExports}`);
  output.push(`Internal Dependencies: ${stats.internalDeps}`);
  output.push(`External Packages: ${stats.externalDeps.size}`);
  output.push('');

  if (stats.externalDeps.size > 0) {
    output.push('External Dependencies:');
    for (const dep of Array.from(stats.externalDeps).sort()) {
      output.push(`  - ${dep}`);
    }
    output.push('');
  }

  if (sortedImported.length > 0) {
    output.push('Most Imported Files:');
    for (const [file, count] of sortedImported) {
      output.push(`  ${count}x ${file}`);
    }
    output.push('');
  }

  if (stats.mostExports.count > 0) {
    output.push(`File with Most Exports: ${stats.mostExports.file} (${stats.mostExports.count})`);
  }

  return output.join('\n');
}

function resolveImport(fromFile: string, importPath: string): string | null {
  const dir = path.dirname(fromFile);
  const extensions = ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js', '/index.jsx'];

  for (const ext of extensions) {
    const resolved = path.resolve(dir, importPath + ext);
    if (fs.existsSync(resolved)) {
      return resolved;
    }
  }

  // Try without extension (might already have one)
  const direct = path.resolve(dir, importPath);
  if (fs.existsSync(direct) && fs.statSync(direct).isFile()) {
    return direct;
  }

  return null;
}
