// src/tools/strategic_code_scanner.ts
import { Tool } from '../types/index.js';
import * as fs from 'fs';
import * as path from 'path';

// CONFIGURATION
const MAX_FILE_SIZE_KB = 100;
// REMOVED '.neo' from this list so the agent can scan its own skills
const IGNORE_DIRS = ['.git', 'node_modules', 'dist', 'build', 'coverage']; 
const SCAN_EXTENSIONS = ['.ts', '.js', '.py', '.tsx', '.jsx'];

interface FileStats {
  path: string;
  sizeKB: number;
  lines: number;
  todoCount: number;
  anyCount: number;
  complexityScore: number;
}

const tool: Tool = {
  name: 'strategic_code_scanner',
  description: 'Automated code intelligence. Generates a "Health Report" identifying high-complexity files, type safety gaps, and TODOs. Use BEFORE manual review.',
  source: 'CORE',
  execute: async (args: { path?: string }) => {
    const rootDir = args.path ? path.resolve(process.cwd(), args.path) : process.cwd();
    const fileStats: FileStats[] = [];
    
    try {
      if (!fs.existsSync(rootDir)) return `Error: Path '${rootDir}' does not exist.`;
      
      scanDirectory(rootDir, fileStats);
    } catch (e: any) {
      return `SCAN FAILED: ${e.message}`;
    }

    if (fileStats.length === 0) return "Scan complete. No matching files found (check extensions or ignore list).";

    // ANALYZE DATA
    fileStats.sort((a, b) => b.complexityScore - a.complexityScore);

    const totalFiles = fileStats.length;
    const totalLines = fileStats.reduce((sum, f) => sum + f.lines, 0);
    const totalTodos = fileStats.reduce((sum, f) => sum + f.todoCount, 0);
    
    // GENERATE REPORT
    let report = `
╔════════════════════════════════════════════════════════════════╗
║             STRATEGIC CODE INTELLIGENCE REPORT                 ║
╚════════════════════════════════════════════════════════════════╝
• Target: ${path.basename(rootDir)}
• Files Scanned: ${totalFiles}
• Total Lines: ${totalLines}
• Technical Debt Markers: ${totalTodos}

[SECTION 1: HIGH COMPLEXITY TARGETS]
(Focus your review efforts here first)
`;

    fileStats.slice(0, 5).forEach(f => {
      report += `\n🔴 ${f.path.replace(process.cwd(), '')}`;
      report += `\n   ├─ Lines: ${f.lines} | Size: ${f.sizeKB.toFixed(1)}KB`;
      report += `\n   ├─ Complexity: ${f.complexityScore}`;
      if (f.anyCount > 0) report += ` | ⚠️ 'any': ${f.anyCount}`;
      if (f.todoCount > 0) report += ` | 📝 TODO: ${f.todoCount}`;
      report += '\n';
    });

    report += `\n[SECTION 2: TYPE SAFETY GAPS]\n`;
    const riskyFiles = fileStats.filter(f => f.anyCount > 0).sort((a, b) => b.anyCount - a.anyCount).slice(0, 5);
    
    if (riskyFiles.length === 0) {
      report += "✅ No explicit 'any' types usage detected.\n";
    } else {
      riskyFiles.forEach(f => {
        report += `⚠️ ${f.path.replace(process.cwd(), '')}: ${f.anyCount} usages\n`;
      });
    }

    report += `\n[SECTION 3: TECHNICAL DEBT]\n`;
    const todoFiles = fileStats.filter(f => f.todoCount > 0);
    
    if (todoFiles.length === 0) {
      report += "✅ Clean. No TODOs found.\n";
    } else {
      todoFiles.forEach(f => {
        report += `📝 ${f.path.replace(process.cwd(), '')} (${f.todoCount})\n`;
      });
    }

    return report;
  }
};

// --- HELPER FUNCTIONS ---
function scanDirectory(currentPath: string, stats: FileStats[]) {
  const items = fs.readdirSync(currentPath, { withFileTypes: true });

  for (const item of items) {
    const fullPath = path.join(currentPath, item.name);

    if (item.isDirectory()) {
      if (!IGNORE_DIRS.includes(item.name)) {
        scanDirectory(fullPath, stats);
      }
    } else if (item.isFile()) {
      const ext = path.extname(item.name);
      if (SCAN_EXTENSIONS.includes(ext)) {
        analyzeFile(fullPath, stats);
      }
    }
  }
}

function analyzeFile(filePath: string, stats: FileStats[]) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const sizeKB = fs.statSync(filePath).size / 1024;

    if (sizeKB > 100) return; 

    const lines = content.split('\n');
    let todoCount = 0;
    let anyCount = 0;
    let indentScore = 0;

    for (const line of lines) {
      if (line.includes('TODO') || line.includes('FIXME')) todoCount++;
      if (line.includes(': any') || line.includes('<any>')) anyCount++;
      const indent = line.search(/\S/);
      if (indent > 8) indentScore++; 
    }

    const complexityScore = Math.floor((lines.length * 0.5) + (indentScore * 2) + (anyCount * 5));

    stats.push({
      path: filePath,
      sizeKB,
      lines: lines.length,
      todoCount,
      anyCount,
      complexityScore
    });
  } catch (e) { }
}

export default tool;