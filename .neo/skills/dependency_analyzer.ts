/* NEO_SKILL_META
{
  "name": "dependency_analyzer",
  "description": "Analyzes project dependencies and suggests updates, identifies security vulnerabilities, or detects outdated packages",
  "argsSchema": {
    "type": "object",
    "properties": {}
  }
}
NEO_SKILL_META */

/* NEO_SKILL_META
{
  "name": "dependency_analyzer",
  "description": "Analyzes project dependencies and suggests updates, identifies security vulnerabilities, or detects outdated packages",
  "argsSchema": {
    "type": "object",
    "properties": {
      "projectPath": { "type": "string", "description": "Path to the project directory (default: current directory)" },
      "checkVulnerabilities": { "type": "boolean", "description": "Check for security vulnerabilities (default: true)" },
      "checkUpdates": { "type": "boolean", "description": "Check for available updates (default: true)" },
      "checkOutdated": { "type": "boolean", "description": "Check for outdated packages (default: true)" },
      "packageManager": { "type": "string", "description": "Package manager to use (npm, yarn, pnpm, pip, go) (default: auto-detect)" }
    },
    "required": []
  }
}
NEO_SKILL_META */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execAsync = promisify(exec);

export async function run(args: { 
  projectPath?: string; 
  checkVulnerabilities?: boolean; 
  checkUpdates?: boolean; 
  checkOutdated?: boolean; 
  packageManager?: string; 
}) {
  const { 
    projectPath = '.', 
    checkVulnerabilities = true, 
    checkUpdates = true, 
    checkOutdated = true, 
    packageManager 
  } = args;
  
  const absPath = path.resolve(process.cwd(), projectPath);
  
  if (!fs.existsSync(absPath)) {
    return `Error: Project path not found at ${absPath}`;
  }
  
  // Detect package manager
  let detectedPackageManager = packageManager || 'auto';
  if (detectedPackageManager === 'auto') {
    if (fs.existsSync(path.join(absPath, 'package.json'))) {
      detectedPackageManager = 'npm';
    } else if (fs.existsSync(path.join(absPath, 'requirements.txt'))) {
      detectedPackageManager = 'pip';
    } else if (fs.existsSync(path.join(absPath, 'go.mod'))) {
      detectedPackageManager = 'go';
    } else if (fs.existsSync(path.join(absPath, 'yarn.lock'))) {
      detectedPackageManager = 'yarn';
    } else if (fs.existsSync(path.join(absPath, 'pnpm-lock.yaml'))) {
      detectedPackageManager = 'pnpm';
    } else {
      return 'Error: Could not detect package manager. Please specify packageManager argument.';
    }
  }
  
  let results = [];
  
  try {
    // Check for vulnerabilities
    if (checkVulnerabilities) {
      let vulnerabilityCheck = '';
      
      switch (detectedPackageManager) {
        case 'npm':
          try {
            const result = await execAsync(`npm audit --json`, { cwd: absPath });
            vulnerabilityCheck = `npm audit results:\n${result.stdout}`;
          } catch (e: any) {
            vulnerabilityCheck = `npm audit failed:\n${e.message}`;
          }
          break;
        
        case 'yarn':
          try {
            const result = await execAsync(`yarn audit --json`, { cwd: absPath });
            vulnerabilityCheck = `yarn audit results:\n${result.stdout}`;
          } catch (e: any) {
            vulnerabilityCheck = `yarn audit failed:\n${e.message}`;
          }
          break;
        
        case 'pip':
          try {
            const result = await execAsync(`pip-audit --json`, { cwd: absPath });
            vulnerabilityCheck = `pip-audit results:\n${result.stdout}`;
          } catch (e: any) {
            vulnerabilityCheck = `pip-audit failed:\n${e.message}`;
          }
          break;
        
        case 'go':
          try {
            const result = await execAsync(`go list -m all`, { cwd: absPath });
            vulnerabilityCheck = `Go modules:\n${result.stdout}`;
          } catch (e: any) {
            vulnerabilityCheck = `Go module check failed:\n${e.message}`;
          }
          break;
        
        default:
          vulnerabilityCheck = `Vulnerability check not implemented for ${detectedPackageManager}`;
      }
      
      results.push(`\n=== Vulnerability Check (${detectedPackageManager}) ===\n${vulnerabilityCheck}`);
    }
    
    // Check for updates
    if (checkUpdates) {
      let updateCheck = '';
      
      switch (detectedPackageManager) {
        case 'npm':
          try {
            const result = await execAsync(`npm outdated --json`, { cwd: absPath });
            updateCheck = `npm outdated results:\n${result.stdout}`;
          } catch (e: any) {
            updateCheck = `npm outdated failed:\n${e.message}`;
          }
          break;
        
        case 'yarn':
          try {
            const result = await execAsync(`yarn outdated --json`, { cwd: absPath });
            updateCheck = `yarn outdated results:\n${result.stdout}`;
          } catch (e: any) {
            updateCheck = `yarn outdated failed:\n${e.message}`;
          }
          break;
        
        case 'pip':
          try {
            const result = await execAsync(`pip list --outdated --format=json`, { cwd: absPath });
            updateCheck = `pip outdated results:\n${result.stdout}`;
          } catch (e: any) {
            updateCheck = `pip outdated check failed:\n${e.message}`;
          }
          break;
        
        case 'go':
          try {
            const result = await execAsync(`go list -u -m all`, { cwd: absPath });
            updateCheck = `Go updates:\n${result.stdout}`;
          } catch (e: any) {
            updateCheck = `Go update check failed:\n${e.message}`;
          }
          break;
        
        default:
          updateCheck = `Update check not implemented for ${detectedPackageManager}`;
      }
      
      results.push(`\n=== Update Check (${detectedPackageManager}) ===\n${updateCheck}`);
    }
    
    // Check for outdated packages
    if (checkOutdated) {
      let outdatedCheck = '';
      
      switch (detectedPackageManager) {
        case 'npm':
          try {
            const result = await execAsync(`npm outdated`, { cwd: absPath });
            outdatedCheck = `npm outdated summary:\n${result.stdout}`;
          } catch (e: any) {
            outdatedCheck = `npm outdated check failed:\n${e.message}`;
          }
          break;
        
        case 'yarn':
          try {
            const result = await execAsync(`yarn outdated`, { cwd: absPath });
            outdatedCheck = `yarn outdated summary:\n${result.stdout}`;
          } catch (e: any) {
            outdatedCheck = `yarn outdated check failed:\n${e.message}`;
          }
          break;
        
        case 'pip':
          try {
            const result = await execAsync(`pip list --outdated`, { cwd: absPath });
            outdatedCheck = `pip outdated summary:\n${result.stdout}`;
          } catch (e: any) {
            outdatedCheck = `pip outdated check failed:\n${e.message}`;
          }
          break;
        
        case 'go':
          try {
            const result = await execAsync(`go list -u -m all`, { cwd: absPath });
            outdatedCheck = `Go outdated packages:\n${result.stdout}`;
          } catch (e: any) {
            outdatedCheck = `Go outdated check failed:\n${e.message}`;
          }
          break;
        
        default:
          outdatedCheck = `Outdated check not implemented for ${detectedPackageManager}`;
      }
      
      results.push(`\n=== Outdated Packages (${detectedPackageManager}) ===\n${outdatedCheck}`);
    }
    
    return results.join('\n');
  } catch (error: any) {
    return `Error running dependency analysis: ${error.message}`;
  }
}
