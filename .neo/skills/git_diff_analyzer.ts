/* NEO_SKILL_META
{
  "name": "git_diff_analyzer",
  "description": "Parse and analyze git diffs. Summarize changes, identify risky modifications, generate PR descriptions, and provide change statistics.",
  "argsSchema": {
    "type": "object",
    "properties": {
      "action": {
        "type": "string",
        "enum": ["analyze", "summarize", "risk", "pr_description", "stats"],
        "description": "Analysis action to perform"
      },
      "input": { "type": "string", "description": "Git diff content or file path (or 'staged' for staged changes, 'unstaged' for working changes)" },
      "options": {
        "type": "object",
        "properties": {
          "baseBranch": { "type": "string", "description": "Base branch for comparison (default: main)" },
          "format": { "type": "string", "enum": ["text", "markdown", "json"], "description": "Output format" }
        }
      }
    },
    "required": ["action"]
  }
}
NEO_SKILL_META */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

interface DiffArgs {
  action: 'analyze' | 'summarize' | 'risk' | 'pr_description' | 'stats';
  input?: string;
  options?: {
    baseBranch?: string;
    format?: 'text' | 'markdown' | 'json';
  };
}

interface FileDiff {
  file: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
  oldPath?: string;
}

interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  header: string;
  changes: string[];
}

interface ChangeCategory {
  category: string;
  files: string[];
  description: string;
}

export async function run(args: DiffArgs): Promise<string> {
  const { action, input = 'staged', options = {} } = args;

  if (!action) {
    return 'Error: action is required';
  }

  try {
    // Get diff content
    const diffContent = getDiffContent(input, options.baseBranch);

    if (!diffContent || diffContent.trim() === '') {
      return 'No changes found. Make sure you have staged changes or specify a valid diff source.';
    }

    switch (action) {
      case 'analyze':
        return analyzeDiff(diffContent, options);
      case 'summarize':
        return summarizeDiff(diffContent, options);
      case 'risk':
        return assessRisk(diffContent, options);
      case 'pr_description':
        return generatePRDescription(diffContent, options);
      case 'stats':
        return generateStats(diffContent, options);
      default:
        return `Error: Unknown action "${action}"`;
    }
  } catch (e: unknown) {
    return `Error: ${(e as Error).message}`;
  }
}

function getDiffContent(input: string, baseBranch?: string): string {
  // Check if it's a special keyword
  if (input === 'staged') {
    try {
      return execSync('git diff --cached', { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
    } catch {
      return '';
    }
  }

  if (input === 'unstaged') {
    try {
      return execSync('git diff', { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
    } catch {
      return '';
    }
  }

  if (input === 'branch') {
    const base = baseBranch || 'main';
    try {
      return execSync(`git diff ${base}...HEAD`, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
    } catch {
      try {
        return execSync(`git diff ${base}..HEAD`, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
      } catch {
        return '';
      }
    }
  }

  // Check if it's a file path
  const absPath = path.resolve(process.cwd(), input);
  if (fs.existsSync(absPath)) {
    return fs.readFileSync(absPath, 'utf-8');
  }

  // Assume it's raw diff content
  return input;
}

function parseDiff(diffContent: string): FileDiff[] {
  const files: FileDiff[] = [];
  const fileRegex = /^diff --git a\/(.+) b\/(.+)$/gm;
  const hunkRegex = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

  const sections = diffContent.split(/^diff --git /m).filter(s => s.trim());

  for (const section of sections) {
    const lines = section.split('\n');
    const headerMatch = lines[0]?.match(/a\/(.+) b\/(.+)/);
    if (!headerMatch) continue;

    const filePath = headerMatch[2];
    const oldPath = headerMatch[1] !== headerMatch[2] ? headerMatch[1] : undefined;

    let status: FileDiff['status'] = 'modified';
    if (section.includes('new file mode')) {
      status = 'added';
    } else if (section.includes('deleted file mode')) {
      status = 'deleted';
    } else if (oldPath) {
      status = 'renamed';
    }

    const hunks: DiffHunk[] = [];
    let additions = 0;
    let deletions = 0;
    let currentHunk: DiffHunk | null = null;

    for (const line of lines) {
      const hunkMatch = line.match(hunkRegex);
      if (hunkMatch) {
        currentHunk = {
          oldStart: parseInt(hunkMatch[1], 10),
          oldCount: parseInt(hunkMatch[2] || '1', 10),
          newStart: parseInt(hunkMatch[3], 10),
          newCount: parseInt(hunkMatch[4] || '1', 10),
          header: hunkMatch[5] || '',
          changes: []
        };
        hunks.push(currentHunk);
        continue;
      }

      if (currentHunk && (line.startsWith('+') || line.startsWith('-') || line.startsWith(' '))) {
        currentHunk.changes.push(line);

        if (line.startsWith('+') && !line.startsWith('+++')) {
          additions++;
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          deletions++;
        }
      }
    }

    files.push({
      file: filePath,
      status,
      additions,
      deletions,
      hunks,
      oldPath
    });
  }

  return files;
}

function analyzeDiff(diffContent: string, options: DiffArgs['options']): string {
  const { format = 'text' } = options || {};
  const files = parseDiff(diffContent);

  if (format === 'json') {
    return JSON.stringify(files, null, 2);
  }

  const output: string[] = [];
  output.push('=== Diff Analysis ===');
  output.push('');

  for (const file of files) {
    const statusIcon = {
      added: '+',
      modified: '~',
      deleted: '-',
      renamed: '>'
    }[file.status];

    output.push(`${statusIcon} ${file.file}${file.oldPath ? ` (from ${file.oldPath})` : ''}`);
    output.push(`  Status: ${file.status}`);
    output.push(`  Changes: +${file.additions} -${file.deletions}`);

    if (file.hunks.length > 0 && format !== 'text') {
      output.push(`  Hunks: ${file.hunks.length}`);
      for (const hunk of file.hunks.slice(0, 3)) {
        output.push(`    @@ ${hunk.oldStart},${hunk.oldCount} -> ${hunk.newStart},${hunk.newCount} @@${hunk.header}`);
      }
    }
    output.push('');
  }

  const totals = files.reduce((acc, f) => ({
    additions: acc.additions + f.additions,
    deletions: acc.deletions + f.deletions
  }), { additions: 0, deletions: 0 });

  output.push(`Total: ${files.length} file(s), +${totals.additions} -${totals.deletions}`);

  return output.join('\n');
}

function summarizeDiff(diffContent: string, options: DiffArgs['options']): string {
  const files = parseDiff(diffContent);

  const output: string[] = [];
  output.push('=== Change Summary ===');
  output.push('');

  // Categorize changes
  const categories: ChangeCategory[] = [];

  const sourceFiles = files.filter(f =>
    ['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.go'].some(ext => f.file.endsWith(ext))
  );
  if (sourceFiles.length > 0) {
    categories.push({
      category: 'Source Code',
      files: sourceFiles.map(f => f.file),
      description: `Modified ${sourceFiles.length} source file(s)`
    });
  }

  const testFiles = files.filter(f =>
    f.file.includes('.test.') || f.file.includes('.spec.') || f.file.includes('__tests__')
  );
  if (testFiles.length > 0) {
    categories.push({
      category: 'Tests',
      files: testFiles.map(f => f.file),
      description: `Updated ${testFiles.length} test file(s)`
    });
  }

  const configFiles = files.filter(f =>
    ['package.json', 'tsconfig.json', '.eslintrc', '.prettierrc', 'webpack.config', 'vite.config'].some(c => f.file.includes(c))
  );
  if (configFiles.length > 0) {
    categories.push({
      category: 'Configuration',
      files: configFiles.map(f => f.file),
      description: `Changed ${configFiles.length} config file(s)`
    });
  }

  const docFiles = files.filter(f =>
    f.file.endsWith('.md') || f.file.endsWith('.txt') || f.file.includes('README')
  );
  if (docFiles.length > 0) {
    categories.push({
      category: 'Documentation',
      files: docFiles.map(f => f.file),
      description: `Updated ${docFiles.length} documentation file(s)`
    });
  }

  for (const cat of categories) {
    output.push(`**${cat.category}**`);
    output.push(cat.description);
    for (const file of cat.files.slice(0, 5)) {
      output.push(`  - ${file}`);
    }
    if (cat.files.length > 5) {
      output.push(`  - ... and ${cat.files.length - 5} more`);
    }
    output.push('');
  }

  return output.join('\n');
}

function assessRisk(diffContent: string, options: DiffArgs['options']): string {
  const files = parseDiff(diffContent);

  const output: string[] = [];
  const risks: { level: 'high' | 'medium' | 'low'; file: string; reason: string }[] = [];

  for (const file of files) {
    // High risk patterns
    if (file.file.includes('security') || file.file.includes('auth') || file.file.includes('password')) {
      risks.push({ level: 'high', file: file.file, reason: 'Security-sensitive file' });
    }

    if (file.file.includes('database') || file.file.includes('migration') || file.file.includes('schema')) {
      risks.push({ level: 'high', file: file.file, reason: 'Database changes' });
    }

    if (file.deletions > 100) {
      risks.push({ level: 'high', file: file.file, reason: `Large deletion (${file.deletions} lines)` });
    }

    // Check for risky patterns in content
    for (const hunk of file.hunks) {
      const content = hunk.changes.join('\n');

      if (/process\.env\.\w+/.test(content)) {
        risks.push({ level: 'medium', file: file.file, reason: 'Environment variable changes' });
      }

      if (/api[_-]?key|secret|token|password/i.test(content)) {
        risks.push({ level: 'high', file: file.file, reason: 'Potential sensitive data' });
      }

      if (/TODO|FIXME|HACK/.test(content)) {
        risks.push({ level: 'low', file: file.file, reason: 'Contains TODO/FIXME comments' });
      }

      if (/console\.(log|debug)/.test(content) && content.includes('+')) {
        risks.push({ level: 'low', file: file.file, reason: 'Added console.log statements' });
      }
    }

    // Medium risk patterns
    if (file.file.includes('config') || file.file === 'package.json') {
      risks.push({ level: 'medium', file: file.file, reason: 'Configuration change' });
    }

    if (file.additions + file.deletions > 500) {
      risks.push({ level: 'medium', file: file.file, reason: 'Large change (>500 lines)' });
    }
  }

  // Deduplicate risks
  const uniqueRisks = risks.filter((risk, index, self) =>
    index === self.findIndex(r => r.file === risk.file && r.reason === risk.reason)
  );

  output.push('=== Risk Assessment ===');
  output.push('');

  const highRisks = uniqueRisks.filter(r => r.level === 'high');
  const mediumRisks = uniqueRisks.filter(r => r.level === 'medium');
  const lowRisks = uniqueRisks.filter(r => r.level === 'low');

  if (highRisks.length > 0) {
    output.push('HIGH RISK:');
    for (const risk of highRisks) {
      output.push(`  ! ${risk.file}: ${risk.reason}`);
    }
    output.push('');
  }

  if (mediumRisks.length > 0) {
    output.push('MEDIUM RISK:');
    for (const risk of mediumRisks) {
      output.push(`  * ${risk.file}: ${risk.reason}`);
    }
    output.push('');
  }

  if (lowRisks.length > 0) {
    output.push('LOW RISK:');
    for (const risk of lowRisks) {
      output.push(`  - ${risk.file}: ${risk.reason}`);
    }
    output.push('');
  }

  if (uniqueRisks.length === 0) {
    output.push('No significant risks identified.');
  }

  output.push('');
  output.push('Recommendations:');
  if (highRisks.length > 0) {
    output.push('  - Request thorough code review for high-risk changes');
  }
  if (mediumRisks.length > 0) {
    output.push('  - Verify configuration changes are intentional');
  }
  output.push('  - Ensure tests cover modified functionality');

  return output.join('\n');
}

function generatePRDescription(diffContent: string, options: DiffArgs['options']): string {
  const files = parseDiff(diffContent);

  const output: string[] = [];

  output.push('## Summary');
  output.push('');
  output.push('<!-- Describe the changes in this PR -->');
  output.push('');

  // Auto-generate summary based on changes
  const totals = files.reduce((acc, f) => ({
    additions: acc.additions + f.additions,
    deletions: acc.deletions + f.deletions
  }), { additions: 0, deletions: 0 });

  output.push(`This PR modifies ${files.length} file(s) with ${totals.additions} additions and ${totals.deletions} deletions.`);
  output.push('');

  output.push('## Changes');
  output.push('');

  // Group by type
  const added = files.filter(f => f.status === 'added');
  const modified = files.filter(f => f.status === 'modified');
  const deleted = files.filter(f => f.status === 'deleted');
  const renamed = files.filter(f => f.status === 'renamed');

  if (added.length > 0) {
    output.push('### Added');
    for (const f of added) {
      output.push(`- \`${f.file}\``);
    }
    output.push('');
  }

  if (modified.length > 0) {
    output.push('### Modified');
    for (const f of modified) {
      output.push(`- \`${f.file}\` (+${f.additions}/-${f.deletions})`);
    }
    output.push('');
  }

  if (deleted.length > 0) {
    output.push('### Deleted');
    for (const f of deleted) {
      output.push(`- \`${f.file}\``);
    }
    output.push('');
  }

  if (renamed.length > 0) {
    output.push('### Renamed');
    for (const f of renamed) {
      output.push(`- \`${f.oldPath}\` → \`${f.file}\``);
    }
    output.push('');
  }

  output.push('## Test Plan');
  output.push('');
  output.push('- [ ] Unit tests pass');
  output.push('- [ ] Integration tests pass');
  output.push('- [ ] Manual testing completed');
  output.push('');

  output.push('## Checklist');
  output.push('');
  output.push('- [ ] Code follows style guidelines');
  output.push('- [ ] Self-review completed');
  output.push('- [ ] Documentation updated (if needed)');
  output.push('- [ ] No breaking changes (or documented)');

  return output.join('\n');
}

function generateStats(diffContent: string, options: DiffArgs['options']): string {
  const { format = 'text' } = options || {};
  const files = parseDiff(diffContent);

  const stats = {
    totalFiles: files.length,
    added: files.filter(f => f.status === 'added').length,
    modified: files.filter(f => f.status === 'modified').length,
    deleted: files.filter(f => f.status === 'deleted').length,
    renamed: files.filter(f => f.status === 'renamed').length,
    totalAdditions: files.reduce((sum, f) => sum + f.additions, 0),
    totalDeletions: files.reduce((sum, f) => sum + f.deletions, 0),
    byExtension: {} as Record<string, { files: number; additions: number; deletions: number }>
  };

  for (const file of files) {
    const ext = path.extname(file.file) || '(no ext)';
    if (!stats.byExtension[ext]) {
      stats.byExtension[ext] = { files: 0, additions: 0, deletions: 0 };
    }
    stats.byExtension[ext].files++;
    stats.byExtension[ext].additions += file.additions;
    stats.byExtension[ext].deletions += file.deletions;
  }

  if (format === 'json') {
    return JSON.stringify(stats, null, 2);
  }

  const output: string[] = [];
  output.push('=== Diff Statistics ===');
  output.push('');
  output.push(`Files changed: ${stats.totalFiles}`);
  output.push(`  Added: ${stats.added}`);
  output.push(`  Modified: ${stats.modified}`);
  output.push(`  Deleted: ${stats.deleted}`);
  output.push(`  Renamed: ${stats.renamed}`);
  output.push('');
  output.push(`Lines changed: ${stats.totalAdditions + stats.totalDeletions}`);
  output.push(`  Additions: +${stats.totalAdditions}`);
  output.push(`  Deletions: -${stats.totalDeletions}`);
  output.push('');

  output.push('By file type:');
  const sortedExts = Object.entries(stats.byExtension).sort((a, b) => b[1].files - a[1].files);
  for (const [ext, data] of sortedExts) {
    output.push(`  ${ext}: ${data.files} file(s), +${data.additions}/-${data.deletions}`);
  }

  return output.join('\n');
}
