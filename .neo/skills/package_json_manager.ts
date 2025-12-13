/* NEO_SKILL_META
{
  "name": "package_json_manager",
  "description": "Manage package.json: add/remove dependencies, manage scripts, bump versions, validate structure, and analyze dependencies.",
  "argsSchema": {
    "type": "object",
    "properties": {
      "action": {
        "type": "string",
        "enum": ["add_dep", "remove_dep", "add_script", "remove_script", "bump_version", "analyze", "validate"],
        "description": "Action to perform"
      },
      "packagePath": { "type": "string", "description": "Path to package.json (default: ./package.json)" },
      "options": {
        "type": "object",
        "properties": {
          "name": { "type": "string", "description": "Dependency or script name" },
          "version": { "type": "string", "description": "Version specifier for dependency" },
          "dev": { "type": "boolean", "description": "Add as devDependency (default: false)" },
          "command": { "type": "string", "description": "Script command" },
          "bumpType": { "type": "string", "enum": ["major", "minor", "patch", "prerelease"], "description": "Version bump type" },
          "dryRun": { "type": "boolean", "description": "Preview changes without writing (default: false)" }
        }
      }
    },
    "required": ["action"]
  }
}
NEO_SKILL_META */

import fs from 'fs';
import path from 'path';

interface PackageArgs {
  action: 'add_dep' | 'remove_dep' | 'add_script' | 'remove_script' | 'bump_version' | 'analyze' | 'validate';
  packagePath?: string;
  options?: {
    name?: string;
    version?: string;
    dev?: boolean;
    command?: string;
    bumpType?: 'major' | 'minor' | 'patch' | 'prerelease';
    dryRun?: boolean;
  };
}

interface PackageJson {
  name?: string;
  version?: string;
  description?: string;
  main?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  [key: string]: unknown;
}

export async function run(args: PackageArgs): Promise<string> {
  const { action, packagePath = 'package.json', options = {} } = args;

  if (!action) {
    return 'Error: action is required';
  }

  try {
    switch (action) {
      case 'add_dep':
        return addDependency(packagePath, options);
      case 'remove_dep':
        return removeDependency(packagePath, options);
      case 'add_script':
        return addScript(packagePath, options);
      case 'remove_script':
        return removeScript(packagePath, options);
      case 'bump_version':
        return bumpVersion(packagePath, options);
      case 'analyze':
        return analyzePackage(packagePath);
      case 'validate':
        return validatePackage(packagePath);
      default:
        return `Error: Unknown action "${action}"`;
    }
  } catch (e: unknown) {
    return `Error: ${(e as Error).message}`;
  }
}

function loadPackageJson(packagePath: string): { pkg: PackageJson; absPath: string } {
  const absPath = path.resolve(process.cwd(), packagePath);

  if (!fs.existsSync(absPath)) {
    throw new Error(`package.json not found at ${absPath}`);
  }

  const content = fs.readFileSync(absPath, 'utf-8');
  return { pkg: JSON.parse(content), absPath };
}

function savePackageJson(absPath: string, pkg: PackageJson): void {
  fs.writeFileSync(absPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
}

function addDependency(packagePath: string, options: PackageArgs['options']): string {
  const { name, version = 'latest', dev = false, dryRun = false } = options || {};

  if (!name) {
    return 'Error: name is required for add_dep action';
  }

  const { pkg, absPath } = loadPackageJson(packagePath);

  const depKey = dev ? 'devDependencies' : 'dependencies';

  if (!pkg[depKey]) {
    pkg[depKey] = {};
  }

  const deps = pkg[depKey] as Record<string, string>;

  // Check if already exists
  if (deps[name]) {
    return `Package "${name}" already exists in ${depKey} with version "${deps[name]}"`;
  }

  // Also check the other dependency type
  const otherKey = dev ? 'dependencies' : 'devDependencies';
  const otherDeps = pkg[otherKey] as Record<string, string> | undefined;
  if (otherDeps?.[name]) {
    return `Package "${name}" already exists in ${otherKey}. Remove it first or use the other dependency type.`;
  }

  const versionSpec = version.startsWith('^') || version.startsWith('~') || version === 'latest'
    ? version
    : `^${version}`;

  if (dryRun) {
    return `[DRY RUN] Would add "${name}": "${versionSpec}" to ${depKey}`;
  }

  deps[name] = versionSpec;

  // Sort dependencies alphabetically
  const sorted = Object.fromEntries(
    Object.entries(deps).sort((a, b) => a[0].localeCompare(b[0]))
  );
  pkg[depKey] = sorted;

  savePackageJson(absPath, pkg);

  return `Added "${name}": "${versionSpec}" to ${depKey}\n\nRun "npm install" to install the package.`;
}

function removeDependency(packagePath: string, options: PackageArgs['options']): string {
  const { name, dryRun = false } = options || {};

  if (!name) {
    return 'Error: name is required for remove_dep action';
  }

  const { pkg, absPath } = loadPackageJson(packagePath);

  let found = false;
  let foundIn = '';

  for (const depKey of ['dependencies', 'devDependencies', 'peerDependencies']) {
    const deps = pkg[depKey] as Record<string, string> | undefined;
    if (deps?.[name]) {
      if (dryRun) {
        return `[DRY RUN] Would remove "${name}" from ${depKey}`;
      }
      delete deps[name];
      found = true;
      foundIn = depKey;
    }
  }

  if (!found) {
    return `Package "${name}" not found in any dependency section`;
  }

  savePackageJson(absPath, pkg);

  return `Removed "${name}" from ${foundIn}\n\nRun "npm install" to update node_modules.`;
}

function addScript(packagePath: string, options: PackageArgs['options']): string {
  const { name, command, dryRun = false } = options || {};

  if (!name || !command) {
    return 'Error: name and command are required for add_script action';
  }

  const { pkg, absPath } = loadPackageJson(packagePath);

  if (!pkg.scripts) {
    pkg.scripts = {};
  }

  const exists = !!pkg.scripts[name];

  if (dryRun) {
    const action = exists ? 'update' : 'add';
    return `[DRY RUN] Would ${action} script "${name}": "${command}"`;
  }

  const oldValue = pkg.scripts[name];
  pkg.scripts[name] = command;

  savePackageJson(absPath, pkg);

  if (exists) {
    return `Updated script "${name}"\n  Old: "${oldValue}"\n  New: "${command}"`;
  }

  return `Added script "${name}": "${command}"\n\nRun with: npm run ${name}`;
}

function removeScript(packagePath: string, options: PackageArgs['options']): string {
  const { name, dryRun = false } = options || {};

  if (!name) {
    return 'Error: name is required for remove_script action';
  }

  const { pkg, absPath } = loadPackageJson(packagePath);

  if (!pkg.scripts?.[name]) {
    return `Script "${name}" not found`;
  }

  if (dryRun) {
    return `[DRY RUN] Would remove script "${name}"`;
  }

  const oldValue = pkg.scripts[name];
  delete pkg.scripts[name];

  savePackageJson(absPath, pkg);

  return `Removed script "${name}" (was: "${oldValue}")`;
}

function bumpVersion(packagePath: string, options: PackageArgs['options']): string {
  const { bumpType = 'patch', dryRun = false } = options || {};

  const { pkg, absPath } = loadPackageJson(packagePath);

  if (!pkg.version) {
    return 'Error: No version field found in package.json';
  }

  const oldVersion = pkg.version;
  const parts = oldVersion.split('-');
  const versionParts = parts[0].split('.').map(Number);
  const prerelease = parts[1];

  let newVersion: string;

  switch (bumpType) {
    case 'major':
      newVersion = `${versionParts[0] + 1}.0.0`;
      break;
    case 'minor':
      newVersion = `${versionParts[0]}.${versionParts[1] + 1}.0`;
      break;
    case 'patch':
      newVersion = `${versionParts[0]}.${versionParts[1]}.${versionParts[2] + 1}`;
      break;
    case 'prerelease':
      if (prerelease) {
        const match = prerelease.match(/^(\w+)\.?(\d+)?$/);
        if (match) {
          const label = match[1];
          const num = match[2] ? parseInt(match[2], 10) + 1 : 1;
          newVersion = `${parts[0]}-${label}.${num}`;
        } else {
          newVersion = `${parts[0]}-beta.1`;
        }
      } else {
        newVersion = `${pkg.version}-beta.1`;
      }
      break;
    default:
      return `Error: Invalid bump type "${bumpType}"`;
  }

  if (dryRun) {
    return `[DRY RUN] Would bump version: ${oldVersion} -> ${newVersion}`;
  }

  pkg.version = newVersion;
  savePackageJson(absPath, pkg);

  return `Version bumped: ${oldVersion} -> ${newVersion}\n\nDon't forget to:\n  1. Update CHANGELOG.md\n  2. Create a git tag: git tag v${newVersion}\n  3. Push: git push --tags`;
}

function analyzePackage(packagePath: string): string {
  const { pkg } = loadPackageJson(packagePath);

  const output: string[] = [];
  output.push('=== Package Analysis ===');
  output.push('');

  // Basic info
  output.push(`Name: ${pkg.name || '(not set)'}`);
  output.push(`Version: ${pkg.version || '(not set)'}`);
  output.push(`Description: ${pkg.description || '(not set)'}`);
  output.push(`Main: ${pkg.main || '(not set)'}`);
  output.push('');

  // Dependencies count
  const depCount = Object.keys(pkg.dependencies || {}).length;
  const devDepCount = Object.keys(pkg.devDependencies || {}).length;
  const peerDepCount = Object.keys(pkg.peerDependencies || {}).length;

  output.push('Dependencies:');
  output.push(`  Production: ${depCount}`);
  output.push(`  Development: ${devDepCount}`);
  output.push(`  Peer: ${peerDepCount}`);
  output.push(`  Total: ${depCount + devDepCount + peerDepCount}`);
  output.push('');

  // Scripts
  const scripts = Object.keys(pkg.scripts || {});
  output.push(`Scripts (${scripts.length}):`);
  for (const script of scripts) {
    const cmd = pkg.scripts![script];
    const truncated = cmd.length > 50 ? cmd.substring(0, 47) + '...' : cmd;
    output.push(`  ${script}: ${truncated}`);
  }
  output.push('');

  // Version analysis
  if (pkg.dependencies || pkg.devDependencies) {
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    const versionPatterns = {
      exact: 0,
      caret: 0,
      tilde: 0,
      range: 0,
      latest: 0,
      other: 0
    };

    for (const version of Object.values(allDeps)) {
      if (version === 'latest' || version === '*') {
        versionPatterns.latest++;
      } else if (version.startsWith('^')) {
        versionPatterns.caret++;
      } else if (version.startsWith('~')) {
        versionPatterns.tilde++;
      } else if (version.includes('-') || version.includes('||')) {
        versionPatterns.range++;
      } else if (/^\d/.test(version)) {
        versionPatterns.exact++;
      } else {
        versionPatterns.other++;
      }
    }

    output.push('Version Patterns:');
    output.push(`  ^ (caret): ${versionPatterns.caret}`);
    output.push(`  ~ (tilde): ${versionPatterns.tilde}`);
    output.push(`  Exact: ${versionPatterns.exact}`);
    output.push(`  Range: ${versionPatterns.range}`);
    output.push(`  Latest/*: ${versionPatterns.latest}`);
    if (versionPatterns.other > 0) {
      output.push(`  Other: ${versionPatterns.other}`);
    }
  }

  return output.join('\n');
}

function validatePackage(packagePath: string): string {
  const { pkg } = loadPackageJson(packagePath);

  const output: string[] = [];
  const issues: string[] = [];
  const warnings: string[] = [];

  output.push('=== Package Validation ===');
  output.push('');

  // Required fields
  if (!pkg.name) {
    issues.push('Missing required field: name');
  } else if (!/^(?:@[a-z0-9-*~][a-z0-9-*._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(pkg.name)) {
    issues.push(`Invalid package name: "${pkg.name}"`);
  }

  if (!pkg.version) {
    issues.push('Missing required field: version');
  } else if (!/^\d+\.\d+\.\d+(-[\w.]+)?(\+[\w.]+)?$/.test(pkg.version)) {
    issues.push(`Invalid semver version: "${pkg.version}"`);
  }

  // Recommended fields
  if (!pkg.description) {
    warnings.push('Missing recommended field: description');
  }

  if (!pkg.main && !pkg.exports) {
    warnings.push('Missing entry point: main or exports');
  }

  if (!pkg.license) {
    warnings.push('Missing license field');
  }

  if (!pkg.repository) {
    warnings.push('Missing repository field');
  }

  // Check for potential issues
  const deps = { ...pkg.dependencies };
  const devDeps = { ...pkg.devDependencies };

  // Duplicates between deps and devDeps
  for (const dep of Object.keys(deps)) {
    if (devDeps[dep]) {
      issues.push(`Duplicate dependency: "${dep}" in both dependencies and devDependencies`);
    }
  }

  // Latest or * versions
  for (const [name, version] of Object.entries({ ...deps, ...devDeps })) {
    if (version === 'latest' || version === '*') {
      warnings.push(`Unpinned version for "${name}": ${version}`);
    }
  }

  // Check scripts
  if (pkg.scripts) {
    const scriptNames = Object.keys(pkg.scripts);

    // Common missing scripts
    const recommended = ['test', 'build', 'start'];
    for (const script of recommended) {
      if (!scriptNames.includes(script)) {
        warnings.push(`Consider adding "${script}" script`);
      }
    }
  } else {
    warnings.push('No scripts defined');
  }

  // Output results
  if (issues.length === 0 && warnings.length === 0) {
    output.push('✓ Package.json is valid with no issues!');
    return output.join('\n');
  }

  if (issues.length > 0) {
    output.push(`Errors (${issues.length}):`);
    for (const issue of issues) {
      output.push(`  ✗ ${issue}`);
    }
    output.push('');
  }

  if (warnings.length > 0) {
    output.push(`Warnings (${warnings.length}):`);
    for (const warning of warnings) {
      output.push(`  ! ${warning}`);
    }
    output.push('');
  }

  output.push(issues.length > 0 ? '✗ Validation failed' : '✓ Validation passed with warnings');

  return output.join('\n');
}
