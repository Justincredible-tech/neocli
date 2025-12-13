/* NEO_SKILL_META
{
  "name": "test_coverage_analyzer",
  "description": "Analyze test coverage reports (Istanbul/NYC format). Identify coverage gaps, suggest test cases, and generate coverage summaries.",
  "argsSchema": {
    "type": "object",
    "properties": {
      "action": {
        "type": "string",
        "enum": ["analyze", "gaps", "suggest", "summary"],
        "description": "Analysis action to perform"
      },
      "coveragePath": { "type": "string", "description": "Path to coverage report (default: coverage/coverage-summary.json)" },
      "options": {
        "type": "object",
        "properties": {
          "threshold": { "type": "number", "description": "Coverage threshold percentage (default: 80)" },
          "showUncovered": { "type": "boolean", "description": "Show uncovered lines (default: true)" },
          "format": { "type": "string", "enum": ["summary", "detailed", "json"], "description": "Output format" }
        }
      }
    },
    "required": ["action"]
  }
}
NEO_SKILL_META */

import fs from 'fs';
import path from 'path';

interface CoverageArgs {
  action: 'analyze' | 'gaps' | 'suggest' | 'summary';
  coveragePath?: string;
  options?: {
    threshold?: number;
    showUncovered?: boolean;
    format?: 'summary' | 'detailed' | 'json';
  };
}

interface CoverageMetrics {
  total: number;
  covered: number;
  skipped: number;
  pct: number;
}

interface FileCoverage {
  lines: CoverageMetrics;
  functions: CoverageMetrics;
  statements: CoverageMetrics;
  branches: CoverageMetrics;
}

interface CoverageSummary {
  total: FileCoverage;
  [filePath: string]: FileCoverage;
}

interface DetailedCoverage {
  path: string;
  statementMap: Record<string, { start: { line: number }; end: { line: number } }>;
  fnMap: Record<string, { name: string; line: number }>;
  branchMap: Record<string, { line: number; type: string }>;
  s: Record<string, number>;
  f: Record<string, number>;
  b: Record<string, number[]>;
}

export async function run(args: CoverageArgs): Promise<string> {
  const {
    action,
    coveragePath = 'coverage/coverage-summary.json',
    options = {}
  } = args;

  if (!action) {
    return 'Error: action is required';
  }

  const { threshold = 80, showUncovered = true, format = 'summary' } = options;

  try {
    switch (action) {
      case 'analyze':
        return analyzeCoverage(coveragePath, threshold, format);
      case 'gaps':
        return findCoverageGaps(coveragePath, threshold, showUncovered);
      case 'suggest':
        return suggestTests(coveragePath, threshold);
      case 'summary':
        return generateSummary(coveragePath, threshold);
      default:
        return `Error: Unknown action "${action}"`;
    }
  } catch (e: unknown) {
    return `Error: ${(e as Error).message}`;
  }
}

function loadCoverage(coveragePath: string): CoverageSummary | null {
  const absPath = path.resolve(process.cwd(), coveragePath);

  if (!fs.existsSync(absPath)) {
    // Try common locations
    const alternatives = [
      'coverage/coverage-summary.json',
      'coverage/coverage-final.json',
      '.nyc_output/coverage-summary.json'
    ];

    for (const alt of alternatives) {
      const altPath = path.resolve(process.cwd(), alt);
      if (fs.existsSync(altPath)) {
        return JSON.parse(fs.readFileSync(altPath, 'utf-8'));
      }
    }

    return null;
  }

  return JSON.parse(fs.readFileSync(absPath, 'utf-8'));
}

function loadDetailedCoverage(): Record<string, DetailedCoverage> | null {
  const paths = [
    'coverage/coverage-final.json',
    '.nyc_output/coverage.json'
  ];

  for (const p of paths) {
    const absPath = path.resolve(process.cwd(), p);
    if (fs.existsSync(absPath)) {
      return JSON.parse(fs.readFileSync(absPath, 'utf-8'));
    }
  }

  return null;
}

function formatPct(pct: number): string {
  const color = pct >= 80 ? '✓' : pct >= 50 ? '~' : '✗';
  return `${color} ${pct.toFixed(1)}%`;
}

function analyzeCoverage(coveragePath: string, threshold: number, format: string): string {
  const coverage = loadCoverage(coveragePath);

  if (!coverage) {
    return `Coverage report not found. Run your test suite with coverage enabled first.\n\nCommon commands:\n  npm test -- --coverage\n  npx vitest run --coverage\n  npx jest --coverage`;
  }

  if (format === 'json') {
    return JSON.stringify(coverage, null, 2);
  }

  const output: string[] = [];
  output.push('=== Coverage Analysis ===');
  output.push(`Threshold: ${threshold}%`);
  output.push('');

  // Total coverage
  if (coverage.total) {
    const total = coverage.total;
    output.push('Overall Coverage:');
    output.push(`  Statements: ${formatPct(total.statements.pct)} (${total.statements.covered}/${total.statements.total})`);
    output.push(`  Branches:   ${formatPct(total.branches.pct)} (${total.branches.covered}/${total.branches.total})`);
    output.push(`  Functions:  ${formatPct(total.functions.pct)} (${total.functions.covered}/${total.functions.total})`);
    output.push(`  Lines:      ${formatPct(total.lines.pct)} (${total.lines.covered}/${total.lines.total})`);
    output.push('');

    const passing = total.statements.pct >= threshold &&
                    total.branches.pct >= threshold &&
                    total.functions.pct >= threshold &&
                    total.lines.pct >= threshold;

    output.push(passing ? '✓ Coverage meets threshold' : '✗ Coverage below threshold');
    output.push('');
  }

  if (format === 'detailed') {
    output.push('Per-File Coverage:');
    output.push('');

    const files = Object.entries(coverage)
      .filter(([key]) => key !== 'total')
      .sort((a, b) => a[1].statements.pct - b[1].statements.pct);

    output.push('| File | Statements | Branches | Functions | Lines |');
    output.push('|------|------------|----------|-----------|-------|');

    for (const [filePath, metrics] of files) {
      const relPath = filePath.length > 40 ? '...' + filePath.slice(-37) : filePath;
      output.push(`| ${relPath} | ${metrics.statements.pct.toFixed(0)}% | ${metrics.branches.pct.toFixed(0)}% | ${metrics.functions.pct.toFixed(0)}% | ${metrics.lines.pct.toFixed(0)}% |`);
    }
  }

  return output.join('\n');
}

function findCoverageGaps(coveragePath: string, threshold: number, showUncovered: boolean): string {
  const coverage = loadCoverage(coveragePath);

  if (!coverage) {
    return 'Coverage report not found. Run tests with coverage first.';
  }

  const output: string[] = [];
  output.push('=== Coverage Gaps ===');
  output.push(`Files below ${threshold}% threshold:`);
  output.push('');

  const gaps: { file: string; metrics: FileCoverage }[] = [];

  for (const [filePath, metrics] of Object.entries(coverage)) {
    if (filePath === 'total') continue;

    if (metrics.statements.pct < threshold ||
        metrics.branches.pct < threshold ||
        metrics.functions.pct < threshold ||
        metrics.lines.pct < threshold) {
      gaps.push({ file: filePath, metrics });
    }
  }

  if (gaps.length === 0) {
    output.push('No files below threshold. Great coverage!');
    return output.join('\n');
  }

  // Sort by lowest coverage
  gaps.sort((a, b) => a.metrics.statements.pct - b.metrics.statements.pct);

  for (const gap of gaps) {
    const relPath = path.relative(process.cwd(), gap.file);
    output.push(`${relPath}`);
    output.push(`  Statements: ${gap.metrics.statements.pct.toFixed(1)}% (${gap.metrics.statements.total - gap.metrics.statements.covered} uncovered)`);
    output.push(`  Branches:   ${gap.metrics.branches.pct.toFixed(1)}% (${gap.metrics.branches.total - gap.metrics.branches.covered} uncovered)`);
    output.push(`  Functions:  ${gap.metrics.functions.pct.toFixed(1)}% (${gap.metrics.functions.total - gap.metrics.functions.covered} uncovered)`);
    output.push(`  Lines:      ${gap.metrics.lines.pct.toFixed(1)}% (${gap.metrics.lines.total - gap.metrics.lines.covered} uncovered)`);
    output.push('');
  }

  // Try to show specific uncovered lines if detailed coverage available
  if (showUncovered) {
    const detailed = loadDetailedCoverage();
    if (detailed) {
      output.push('--- Uncovered Lines ---');
      output.push('');

      for (const gap of gaps.slice(0, 5)) { // Top 5 gaps
        const fileDetail = detailed[gap.file];
        if (!fileDetail) continue;

        const uncoveredStatements: number[] = [];
        for (const [id, count] of Object.entries(fileDetail.s)) {
          if (count === 0 && fileDetail.statementMap[id]) {
            uncoveredStatements.push(fileDetail.statementMap[id].start.line);
          }
        }

        if (uncoveredStatements.length > 0) {
          const relPath = path.relative(process.cwd(), gap.file);
          const uniqueLines = [...new Set(uncoveredStatements)].sort((a, b) => a - b);
          output.push(`${relPath}:`);
          output.push(`  Uncovered lines: ${formatLineRanges(uniqueLines)}`);
          output.push('');
        }
      }
    }
  }

  output.push(`Total files below threshold: ${gaps.length}`);

  return output.join('\n');
}

function formatLineRanges(lines: number[]): string {
  if (lines.length === 0) return 'none';
  if (lines.length <= 5) return lines.join(', ');

  // Group consecutive lines into ranges
  const ranges: string[] = [];
  let start = lines[0];
  let end = lines[0];

  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === end + 1) {
      end = lines[i];
    } else {
      ranges.push(start === end ? `${start}` : `${start}-${end}`);
      start = lines[i];
      end = lines[i];
    }
  }
  ranges.push(start === end ? `${start}` : `${start}-${end}`);

  const result = ranges.slice(0, 10).join(', ');
  return ranges.length > 10 ? result + `, ... (${ranges.length - 10} more ranges)` : result;
}

function suggestTests(coveragePath: string, threshold: number): string {
  const coverage = loadCoverage(coveragePath);
  const detailed = loadDetailedCoverage();

  if (!coverage) {
    return 'Coverage report not found. Run tests with coverage first.';
  }

  const output: string[] = [];
  output.push('=== Test Suggestions ===');
  output.push('');

  // Find files with lowest coverage
  const filesWithGaps = Object.entries(coverage)
    .filter(([key]) => key !== 'total')
    .filter(([, metrics]) => metrics.statements.pct < threshold)
    .sort((a, b) => a[1].statements.pct - b[1].statements.pct)
    .slice(0, 10);

  if (filesWithGaps.length === 0) {
    output.push('All files meet the coverage threshold. Consider:');
    output.push('  - Adding edge case tests');
    output.push('  - Testing error scenarios');
    output.push('  - Adding integration tests');
    return output.join('\n');
  }

  for (const [filePath, metrics] of filesWithGaps) {
    const relPath = path.relative(process.cwd(), filePath);
    const fileName = path.basename(filePath, path.extname(filePath));

    output.push(`## ${relPath}`);
    output.push(`Current: ${metrics.statements.pct.toFixed(1)}% | Target: ${threshold}%`);
    output.push('');

    // Analyze what's uncovered
    const fileDetail = detailed?.[filePath];
    const suggestions: string[] = [];

    if (metrics.functions.pct < threshold) {
      const uncoveredFunctions = fileDetail
        ? Object.entries(fileDetail.f)
            .filter(([, count]) => count === 0)
            .map(([id]) => fileDetail.fnMap[id]?.name || 'anonymous')
            .filter(name => name !== 'anonymous')
        : [];

      if (uncoveredFunctions.length > 0) {
        suggestions.push(`Test uncovered functions: ${uncoveredFunctions.slice(0, 5).join(', ')}`);
      } else {
        suggestions.push(`Add tests for ${metrics.functions.total - metrics.functions.covered} uncovered function(s)`);
      }
    }

    if (metrics.branches.pct < threshold) {
      suggestions.push(`Add tests for ${metrics.branches.total - metrics.branches.covered} uncovered branch(es) - check if/else, switch cases, ternaries`);
    }

    if (metrics.lines.pct < threshold) {
      suggestions.push(`Cover ${metrics.lines.total - metrics.lines.covered} more line(s)`);
    }

    // General suggestions based on file name/path
    if (filePath.includes('controller') || filePath.includes('route')) {
      suggestions.push('Add API endpoint tests with different request scenarios');
    }
    if (filePath.includes('service')) {
      suggestions.push('Test service methods with various inputs and edge cases');
    }
    if (filePath.includes('util') || filePath.includes('helper')) {
      suggestions.push('Add unit tests for utility functions with boundary values');
    }
    if (filePath.includes('model') || filePath.includes('entity')) {
      suggestions.push('Test model validation and transformation logic');
    }

    output.push('Suggestions:');
    for (const suggestion of suggestions.slice(0, 5)) {
      output.push(`  - ${suggestion}`);
    }

    output.push('');
    output.push(`Suggested test file: ${fileName}.test.ts`);
    output.push('```typescript');
    output.push(`describe('${fileName}', () => {`);
    output.push(`  it('should handle basic functionality', () => {`);
    output.push(`    // TODO: Add test`);
    output.push(`  });`);
    output.push('');
    output.push(`  it('should handle edge cases', () => {`);
    output.push(`    // TODO: Add edge case tests`);
    output.push(`  });`);
    output.push('');
    output.push(`  it('should handle errors gracefully', () => {`);
    output.push(`    // TODO: Add error handling tests`);
    output.push(`  });`);
    output.push('});');
    output.push('```');
    output.push('');
    output.push('---');
    output.push('');
  }

  return output.join('\n');
}

function generateSummary(coveragePath: string, threshold: number): string {
  const coverage = loadCoverage(coveragePath);

  if (!coverage) {
    return 'Coverage report not found. Run tests with coverage first.';
  }

  const files = Object.entries(coverage).filter(([key]) => key !== 'total');

  const stats = {
    total: files.length,
    passing: 0,
    failing: 0,
    avgStatements: 0,
    avgBranches: 0,
    avgFunctions: 0,
    avgLines: 0
  };

  for (const [, metrics] of files) {
    const passes = metrics.statements.pct >= threshold;
    if (passes) stats.passing++;
    else stats.failing++;

    stats.avgStatements += metrics.statements.pct;
    stats.avgBranches += metrics.branches.pct;
    stats.avgFunctions += metrics.functions.pct;
    stats.avgLines += metrics.lines.pct;
  }

  if (files.length > 0) {
    stats.avgStatements /= files.length;
    stats.avgBranches /= files.length;
    stats.avgFunctions /= files.length;
    stats.avgLines /= files.length;
  }

  const output: string[] = [];
  output.push('=== Coverage Summary ===');
  output.push('');
  output.push(`Files Analyzed: ${stats.total}`);
  output.push(`Meeting Threshold (${threshold}%): ${stats.passing} (${(stats.passing / stats.total * 100).toFixed(1)}%)`);
  output.push(`Below Threshold: ${stats.failing}`);
  output.push('');
  output.push('Average Coverage:');
  output.push(`  Statements: ${stats.avgStatements.toFixed(1)}%`);
  output.push(`  Branches:   ${stats.avgBranches.toFixed(1)}%`);
  output.push(`  Functions:  ${stats.avgFunctions.toFixed(1)}%`);
  output.push(`  Lines:      ${stats.avgLines.toFixed(1)}%`);
  output.push('');

  if (coverage.total) {
    const total = coverage.total;
    const overallPct = (total.statements.pct + total.branches.pct + total.functions.pct + total.lines.pct) / 4;

    output.push('Overall Health:');
    if (overallPct >= 80) {
      output.push('  ✓ Excellent coverage! Keep it up.');
    } else if (overallPct >= 60) {
      output.push('  ~ Good coverage, but room for improvement.');
    } else if (overallPct >= 40) {
      output.push('  ✗ Coverage needs work. Focus on critical paths.');
    } else {
      output.push('  ✗ Low coverage. Consider adding tests incrementally.');
    }
  }

  return output.join('\n');
}
