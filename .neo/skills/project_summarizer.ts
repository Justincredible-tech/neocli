/* NEO_SKILL_META
{
  "name": "project_summarizer",
  "description": "Generates a comprehensive summary of the project by analyzing package.json, file structure, and key source files. Use this to quickly understand a project's purpose without reading every file manually.",
  "argsSchema": {
    "path": "Root directory (optional)"
  }
}
NEO_SKILL_META */

import * as fs from 'fs';
import * as path from 'path';

export async function run(args: any): Promise<string> {
  const root = args.path ? path.resolve(process.cwd(), args.path) : process.cwd();
  
  let summary = "PROJECT ANALYSIS\n================\n";
  
  // 1. Check Identity (package.json)
  try {
    const pkgPath = path.join(root, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      summary += `Name: ${pkg.name}\nVersion: ${pkg.version}\nDescription: ${pkg.description}\n`;
      if (pkg.scripts) {
        summary += `Scripts: ${Object.keys(pkg.scripts).join(', ')}\n`;
      }
      if (pkg.dependencies) {
        summary += `Key Deps: ${Object.keys(pkg.dependencies).slice(0, 5).join(', ')}...\n`;
      }
    }
  } catch (e) {
    summary += "No package.json found.\n";
  }

  // 2. Scan Core Logic
  summary += "\nCORE ARCHITECTURE:\n";
  const coreDir = path.join(root, 'src', 'core');
  if (fs.existsSync(coreDir)) {
    const files = fs.readdirSync(coreDir);
    summary += `Found ${files.length} core modules in src/core.\n`;
    // We peep at agent.ts specifically
    if (files.includes('agent.ts')) {
        summary += "- agent.ts: Appears to be the main autonomous agent logic.\n";
    }
  }

  // 3. Scan Tools
  const toolsDir = path.join(root, 'src', 'tools');
  if (fs.existsSync(toolsDir)) {
     const tools = fs.readdirSync(toolsDir).filter(f => f.endsWith('.ts'));
     summary += `\nTOOLS (${tools.length}):\n${tools.map(t => '- ' + t.replace('.ts', '')).join('\n')}\n`;
  }

  // 4. Scan Skills
  const skillsDir = path.join(root, '.neo', 'skills');
  if (fs.existsSync(skillsDir)) {
     const skills = fs.readdirSync(skillsDir).filter(f => f.endsWith('.ts'));
     summary += `\nSKILLS (${skills.length}):\n${skills.map(s => '- ' + s.replace('.ts', '')).join('\n')}\n`;
  }

  return summary;
}