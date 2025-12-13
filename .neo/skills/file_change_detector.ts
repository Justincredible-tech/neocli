/* NEO_SKILL_META
{
  "name": "file_change_detector",
  "description": "Snapshot-based file change detection. Create snapshots, compare states, generate change reports, and track modifications over time.",
  "argsSchema": {
    "type": "object",
    "properties": {
      "action": {
        "type": "string",
        "enum": ["snapshot", "compare", "changes", "watch"],
        "description": "Action to perform"
      },
      "path": { "type": "string", "description": "Directory to monitor" },
      "options": {
        "type": "object",
        "properties": {
          "snapshotId": { "type": "string", "description": "Snapshot ID for comparison" },
          "snapshotFile": { "type": "string", "description": "Path to save/load snapshot" },
          "include": { "type": "array", "items": { "type": "string" }, "description": "Glob patterns to include" },
          "exclude": { "type": "array", "items": { "type": "string" }, "description": "Patterns to exclude" },
          "checkContent": { "type": "boolean", "description": "Include content hash in snapshot (default: true)" }
        }
      }
    },
    "required": ["action", "path"]
  }
}
NEO_SKILL_META */

import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { glob } from 'glob';

interface DetectorArgs {
  action: 'snapshot' | 'compare' | 'changes' | 'watch';
  path: string;
  options?: {
    snapshotId?: string;
    snapshotFile?: string;
    include?: string[];
    exclude?: string[];
    checkContent?: boolean;
  };
}

interface FileInfo {
  path: string;
  size: number;
  modified: number;
  hash?: string;
}

interface Snapshot {
  id: string;
  timestamp: number;
  directory: string;
  files: FileInfo[];
}

interface ChangeReport {
  added: FileInfo[];
  modified: FileInfo[];
  deleted: FileInfo[];
  unchanged: number;
}

export async function run(args: DetectorArgs): Promise<string> {
  const { action, path: inputPath, options = {} } = args;

  if (!action || !inputPath) {
    return 'Error: action and path are required';
  }

  try {
    switch (action) {
      case 'snapshot':
        return createSnapshot(inputPath, options);
      case 'compare':
        return compareSnapshots(inputPath, options);
      case 'changes':
        return detectChanges(inputPath, options);
      case 'watch':
        return watchDirectory(inputPath, options);
      default:
        return `Error: Unknown action "${action}"`;
    }
  } catch (e: unknown) {
    return `Error: ${(e as Error).message}`;
  }
}

async function getFiles(inputPath: string, include?: string[], exclude?: string[]): Promise<string[]> {
  const absPath = path.resolve(process.cwd(), inputPath);

  if (!fs.existsSync(absPath)) {
    throw new Error(`Path not found: ${absPath}`);
  }

  const defaultExclude = ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**'];
  const patterns = include && include.length > 0 ? include : ['**/*'];
  const ignorePatterns = [...defaultExclude, ...(exclude || [])];

  const files: string[] = [];

  for (const pattern of patterns) {
    const matches = await glob(pattern, {
      cwd: absPath,
      absolute: true,
      ignore: ignorePatterns,
      nodir: true
    });
    files.push(...matches);
  }

  return [...new Set(files)]; // Deduplicate
}

function hashFile(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return createHash('md5').update(content).digest('hex');
}

function getFileInfo(filePath: string, checkContent: boolean): FileInfo {
  const stats = fs.statSync(filePath);

  const info: FileInfo = {
    path: filePath,
    size: stats.size,
    modified: stats.mtimeMs
  };

  if (checkContent) {
    try {
      info.hash = hashFile(filePath);
    } catch {
      // Skip files we can't read
    }
  }

  return info;
}

async function createSnapshot(inputPath: string, options: DetectorArgs['options']): Promise<string> {
  const { snapshotFile, include, exclude, checkContent = true } = options || {};

  const absPath = path.resolve(process.cwd(), inputPath);
  const files = await getFiles(inputPath, include, exclude);

  const fileInfos: FileInfo[] = [];
  for (const file of files) {
    try {
      fileInfos.push(getFileInfo(file, checkContent));
    } catch {
      // Skip files we can't access
    }
  }

  const snapshot: Snapshot = {
    id: `snap_${Date.now()}`,
    timestamp: Date.now(),
    directory: absPath,
    files: fileInfos
  };

  // Save snapshot if path provided
  if (snapshotFile) {
    const snapshotPath = path.resolve(process.cwd(), snapshotFile);
    fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2), 'utf-8');
  }

  const output: string[] = [];
  output.push('=== Snapshot Created ===');
  output.push('');
  output.push(`ID: ${snapshot.id}`);
  output.push(`Timestamp: ${new Date(snapshot.timestamp).toISOString()}`);
  output.push(`Directory: ${snapshot.directory}`);
  output.push(`Files: ${snapshot.files.length}`);
  output.push(`Content hashes: ${checkContent ? 'Yes' : 'No'}`);

  if (snapshotFile) {
    output.push(`Saved to: ${snapshotFile}`);
  }

  output.push('');
  output.push('To compare later, use:');
  output.push('  action: "compare"');
  output.push(`  snapshotId: "${snapshot.id}"`);
  if (snapshotFile) {
    output.push(`  snapshotFile: "${snapshotFile}"`);
  }

  // Store in memory (simplified - in real implementation would persist)
  (global as Record<string, unknown>).__fileSnapshots = (global as Record<string, unknown>).__fileSnapshots || {};
  ((global as Record<string, unknown>).__fileSnapshots as Record<string, Snapshot>)[snapshot.id] = snapshot;

  return output.join('\n');
}

async function compareSnapshots(inputPath: string, options: DetectorArgs['options']): Promise<string> {
  const { snapshotId, snapshotFile, include, exclude, checkContent = true } = options || {};

  // Load previous snapshot
  let oldSnapshot: Snapshot | null = null;

  if (snapshotFile) {
    const snapshotPath = path.resolve(process.cwd(), snapshotFile);
    if (fs.existsSync(snapshotPath)) {
      oldSnapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
    }
  } else if (snapshotId) {
    const snapshots = (global as Record<string, unknown>).__fileSnapshots as Record<string, Snapshot> || {};
    oldSnapshot = snapshots[snapshotId];
  }

  if (!oldSnapshot) {
    return 'Error: No snapshot found. Create a snapshot first with action: "snapshot"';
  }

  // Create current state
  const files = await getFiles(inputPath, include, exclude);
  const currentFiles = new Map<string, FileInfo>();

  for (const file of files) {
    try {
      const info = getFileInfo(file, checkContent);
      currentFiles.set(file, info);
    } catch {
      // Skip
    }
  }

  // Compare
  const oldFiles = new Map(oldSnapshot.files.map(f => [f.path, f]));
  const report: ChangeReport = {
    added: [],
    modified: [],
    deleted: [],
    unchanged: 0
  };

  // Check for added and modified
  for (const [filePath, info] of currentFiles) {
    const oldInfo = oldFiles.get(filePath);

    if (!oldInfo) {
      report.added.push(info);
    } else if (checkContent && info.hash !== oldInfo.hash) {
      report.modified.push(info);
    } else if (info.size !== oldInfo.size || Math.abs(info.modified - oldInfo.modified) > 1000) {
      report.modified.push(info);
    } else {
      report.unchanged++;
    }
  }

  // Check for deleted
  for (const [filePath, info] of oldFiles) {
    if (!currentFiles.has(filePath)) {
      report.deleted.push(info);
    }
  }

  // Format output
  const output: string[] = [];
  output.push('=== Comparison Report ===');
  output.push('');
  output.push(`Comparing against: ${oldSnapshot.id}`);
  output.push(`Snapshot date: ${new Date(oldSnapshot.timestamp).toISOString()}`);
  output.push('');

  output.push('Summary:');
  output.push(`  Added: ${report.added.length}`);
  output.push(`  Modified: ${report.modified.length}`);
  output.push(`  Deleted: ${report.deleted.length}`);
  output.push(`  Unchanged: ${report.unchanged}`);
  output.push('');

  if (report.added.length > 0) {
    output.push('Added files:');
    for (const f of report.added.slice(0, 20)) {
      const relPath = path.relative(process.cwd(), f.path);
      output.push(`  + ${relPath}`);
    }
    if (report.added.length > 20) {
      output.push(`  ... and ${report.added.length - 20} more`);
    }
    output.push('');
  }

  if (report.modified.length > 0) {
    output.push('Modified files:');
    for (const f of report.modified.slice(0, 20)) {
      const relPath = path.relative(process.cwd(), f.path);
      output.push(`  ~ ${relPath}`);
    }
    if (report.modified.length > 20) {
      output.push(`  ... and ${report.modified.length - 20} more`);
    }
    output.push('');
  }

  if (report.deleted.length > 0) {
    output.push('Deleted files:');
    for (const f of report.deleted.slice(0, 20)) {
      const relPath = path.relative(process.cwd(), f.path);
      output.push(`  - ${relPath}`);
    }
    if (report.deleted.length > 20) {
      output.push(`  ... and ${report.deleted.length - 20} more`);
    }
    output.push('');
  }

  return output.join('\n');
}

async function detectChanges(inputPath: string, options: DetectorArgs['options']): Promise<string> {
  const { include, exclude, checkContent = true } = options || {};

  const absPath = path.resolve(process.cwd(), inputPath);
  const files = await getFiles(inputPath, include, exclude);

  // Check for recent modifications (last 24 hours)
  const dayAgo = Date.now() - (24 * 60 * 60 * 1000);
  const recentChanges: { path: string; modified: Date; size: number }[] = [];

  for (const file of files) {
    try {
      const stats = fs.statSync(file);
      if (stats.mtimeMs > dayAgo) {
        recentChanges.push({
          path: file,
          modified: new Date(stats.mtimeMs),
          size: stats.size
        });
      }
    } catch {
      // Skip
    }
  }

  // Sort by modification time (newest first)
  recentChanges.sort((a, b) => b.modified.getTime() - a.modified.getTime());

  const output: string[] = [];
  output.push('=== Recent Changes (Last 24 Hours) ===');
  output.push('');
  output.push(`Directory: ${absPath}`);
  output.push(`Total files: ${files.length}`);
  output.push(`Recently modified: ${recentChanges.length}`);
  output.push('');

  if (recentChanges.length === 0) {
    output.push('No changes detected in the last 24 hours.');
  } else {
    output.push('Recent changes:');
    for (const change of recentChanges.slice(0, 30)) {
      const relPath = path.relative(process.cwd(), change.path);
      const timeAgo = formatTimeAgo(change.modified);
      output.push(`  ${timeAgo.padEnd(15)} ${relPath}`);
    }

    if (recentChanges.length > 30) {
      output.push(`  ... and ${recentChanges.length - 30} more`);
    }
  }

  return output.join('\n');
}

async function watchDirectory(inputPath: string, options: DetectorArgs['options']): Promise<string> {
  // Note: This is a one-time check. True watching would require a long-running process.
  const { include, exclude } = options || {};

  const absPath = path.resolve(process.cwd(), inputPath);
  const files = await getFiles(inputPath, include, exclude);

  // Create a quick snapshot for reference
  const fileStats = new Map<string, { size: number; mtime: number }>();

  for (const file of files) {
    try {
      const stats = fs.statSync(file);
      fileStats.set(file, { size: stats.size, mtime: stats.mtimeMs });
    } catch {
      // Skip
    }
  }

  const output: string[] = [];
  output.push('=== Watch Status ===');
  output.push('');
  output.push(`Directory: ${absPath}`);
  output.push(`Monitoring: ${files.length} files`);
  output.push('');

  // Categorize by extension
  const byExt = new Map<string, number>();
  for (const file of files) {
    const ext = path.extname(file) || '(no ext)';
    byExt.set(ext, (byExt.get(ext) || 0) + 1);
  }

  output.push('Files by type:');
  const sortedExts = Array.from(byExt.entries()).sort((a, b) => b[1] - a[1]);
  for (const [ext, count] of sortedExts.slice(0, 10)) {
    output.push(`  ${ext}: ${count}`);
  }

  output.push('');
  output.push('Note: For continuous watching, use tools like:');
  output.push('  - nodemon');
  output.push('  - chokidar');
  output.push('  - fs.watch (Node.js built-in)');
  output.push('');
  output.push('To detect changes since now, create a snapshot first:');
  output.push('  action: "snapshot"');
  output.push('  snapshotFile: ".neo/baseline.json"');

  return output.join('\n');
}

function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
