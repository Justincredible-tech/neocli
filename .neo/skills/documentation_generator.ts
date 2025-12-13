/* NEO_SKILL_META
{
  "name": "documentation_generator",
  "description": "Generate documentation from code. Extracts JSDoc/TSDoc comments, generates markdown docs, README sections, and API endpoint documentation.",
  "argsSchema": {
    "type": "object",
    "properties": {
      "action": {
        "type": "string",
        "enum": ["extract_jsdoc", "generate_readme", "api_docs", "module_docs"],
        "description": "Documentation action to perform"
      },
      "input": { "type": "string", "description": "File or directory path" },
      "options": {
        "type": "object",
        "properties": {
          "format": { "type": "string", "enum": ["markdown", "json", "html"], "description": "Output format (default: markdown)" },
          "includePrivate": { "type": "boolean", "description": "Include private members (default: false)" },
          "outputPath": { "type": "string", "description": "Path to save generated docs" }
        }
      }
    },
    "required": ["action", "input"]
  }
}
NEO_SKILL_META */

import fs from 'fs';
import path from 'path';
import { glob } from 'glob';

interface DocArgs {
  action: 'extract_jsdoc' | 'generate_readme' | 'api_docs' | 'module_docs';
  input: string;
  options?: {
    format?: 'markdown' | 'json' | 'html';
    includePrivate?: boolean;
    outputPath?: string;
  };
}

interface JSDocEntry {
  name: string;
  type: 'function' | 'class' | 'interface' | 'type' | 'const' | 'variable';
  description: string;
  params?: { name: string; type: string; description: string }[];
  returns?: { type: string; description: string };
  examples?: string[];
  tags: { tag: string; value: string }[];
  exported: boolean;
  line: number;
}

export async function run(args: DocArgs): Promise<string> {
  const { action, input, options = {} } = args;

  if (!action || !input) {
    return 'Error: action and input are required';
  }

  try {
    switch (action) {
      case 'extract_jsdoc':
        return extractJSDoc(input, options);
      case 'generate_readme':
        return generateReadme(input, options);
      case 'api_docs':
        return generateApiDocs(input, options);
      case 'module_docs':
        return generateModuleDocs(input, options);
      default:
        return `Error: Unknown action "${action}"`;
    }
  } catch (e: unknown) {
    return `Error: ${(e as Error).message}`;
  }
}

function parseJSDocComments(content: string): JSDocEntry[] {
  const entries: JSDocEntry[] = [];
  const jsdocRegex = /\/\*\*\s*([\s\S]*?)\s*\*\/\s*(export\s+)?(async\s+)?(function|class|interface|type|const|let|var)\s+(\w+)/g;

  let match;
  while ((match = jsdocRegex.exec(content)) !== null) {
    const commentBlock = match[1];
    const exported = !!match[2];
    const declType = match[4] as JSDocEntry['type'];
    const name = match[5];
    const lineNum = content.substring(0, match.index).split('\n').length;

    const entry: JSDocEntry = {
      name,
      type: declType === 'let' || declType === 'var' ? 'variable' : declType === 'const' ? 'const' : declType,
      description: '',
      params: [],
      tags: [],
      exported,
      line: lineNum
    };

    // Parse JSDoc content
    const lines = commentBlock.split('\n').map(l => l.replace(/^\s*\*\s?/, '').trim());

    let currentDesc: string[] = [];
    let inExample = false;
    let exampleCode: string[] = [];

    for (const line of lines) {
      if (line.startsWith('@')) {
        // Save description if we have one
        if (currentDesc.length > 0 && !entry.description) {
          entry.description = currentDesc.join(' ').trim();
          currentDesc = [];
        }

        // Handle example end
        if (inExample) {
          if (!entry.examples) entry.examples = [];
          entry.examples.push(exampleCode.join('\n'));
          exampleCode = [];
          inExample = false;
        }

        const tagMatch = line.match(/@(\w+)\s*(.*)/);
        if (tagMatch) {
          const tag = tagMatch[1];
          const value = tagMatch[2];

          if (tag === 'param') {
            const paramMatch = value.match(/\{([^}]+)\}\s*(\w+)\s*-?\s*(.*)/);
            if (paramMatch) {
              entry.params!.push({
                type: paramMatch[1],
                name: paramMatch[2],
                description: paramMatch[3] || ''
              });
            }
          } else if (tag === 'returns' || tag === 'return') {
            const returnMatch = value.match(/\{([^}]+)\}\s*(.*)/);
            if (returnMatch) {
              entry.returns = {
                type: returnMatch[1],
                description: returnMatch[2] || ''
              };
            }
          } else if (tag === 'example') {
            inExample = true;
          } else {
            entry.tags.push({ tag, value });
          }
        }
      } else if (inExample) {
        exampleCode.push(line);
      } else if (line) {
        currentDesc.push(line);
      }
    }

    // Final saves
    if (currentDesc.length > 0 && !entry.description) {
      entry.description = currentDesc.join(' ').trim();
    }
    if (inExample && exampleCode.length > 0) {
      if (!entry.examples) entry.examples = [];
      entry.examples.push(exampleCode.join('\n'));
    }

    entries.push(entry);
  }

  return entries;
}

async function extractJSDoc(input: string, options: DocArgs['options']): Promise<string> {
  const { format = 'markdown', includePrivate = false } = options || {};

  const absPath = path.resolve(process.cwd(), input);

  if (!fs.existsSync(absPath)) {
    return `Error: Path not found: ${absPath}`;
  }

  let files: string[];
  if (fs.statSync(absPath).isDirectory()) {
    files = await glob('**/*.{ts,js,tsx,jsx}', { cwd: absPath, absolute: true });
  } else {
    files = [absPath];
  }

  const allEntries: { file: string; entries: JSDocEntry[] }[] = [];

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');
    const entries = parseJSDocComments(content);
    const filtered = includePrivate ? entries : entries.filter(e => e.exported);

    if (filtered.length > 0) {
      allEntries.push({
        file: path.relative(process.cwd(), file),
        entries: filtered
      });
    }
  }

  if (format === 'json') {
    return JSON.stringify(allEntries, null, 2);
  }

  // Markdown format
  const output: string[] = [];
  output.push('# API Documentation');
  output.push('');

  for (const { file, entries } of allEntries) {
    output.push(`## ${file}`);
    output.push('');

    for (const entry of entries) {
      output.push(`### ${entry.type} \`${entry.name}\``);
      output.push('');

      if (entry.description) {
        output.push(entry.description);
        output.push('');
      }

      if (entry.params && entry.params.length > 0) {
        output.push('**Parameters:**');
        output.push('');
        output.push('| Name | Type | Description |');
        output.push('|------|------|-------------|');
        for (const p of entry.params) {
          output.push(`| \`${p.name}\` | \`${p.type}\` | ${p.description} |`);
        }
        output.push('');
      }

      if (entry.returns) {
        output.push(`**Returns:** \`${entry.returns.type}\` - ${entry.returns.description}`);
        output.push('');
      }

      if (entry.examples && entry.examples.length > 0) {
        output.push('**Example:**');
        output.push('');
        for (const ex of entry.examples) {
          output.push('```javascript');
          output.push(ex);
          output.push('```');
          output.push('');
        }
      }

      output.push('---');
      output.push('');
    }
  }

  return output.join('\n');
}

async function generateReadme(input: string, options: DocArgs['options']): Promise<string> {
  const absPath = path.resolve(process.cwd(), input);

  if (!fs.existsSync(absPath) || !fs.statSync(absPath).isDirectory()) {
    return 'Error: Input must be a directory path';
  }

  // Check for package.json
  const pkgPath = path.join(absPath, 'package.json');
  let pkg: Record<string, unknown> = {};
  if (fs.existsSync(pkgPath)) {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  }

  // Find main entry file
  const mainFile = pkg.main as string || 'src/index.ts';
  const mainPath = path.join(absPath, mainFile);

  const output: string[] = [];

  // Title and description
  const name = (pkg.name as string) || path.basename(absPath);
  output.push(`# ${name}`);
  output.push('');

  if (pkg.description) {
    output.push(pkg.description as string);
    output.push('');
  }

  // Badges
  if (pkg.version) {
    output.push(`![Version](https://img.shields.io/badge/version-${pkg.version}-blue)`);
  }
  if (pkg.license) {
    output.push(`![License](https://img.shields.io/badge/license-${pkg.license}-green)`);
  }
  output.push('');

  // Installation
  output.push('## Installation');
  output.push('');
  output.push('```bash');
  output.push(`npm install ${name}`);
  output.push('```');
  output.push('');

  // Usage
  output.push('## Usage');
  output.push('');
  output.push('```javascript');
  output.push(`import { /* exports */ } from '${name}';`);
  output.push('```');
  output.push('');

  // Scripts
  if (pkg.scripts && typeof pkg.scripts === 'object') {
    output.push('## Available Scripts');
    output.push('');
    for (const [script, command] of Object.entries(pkg.scripts as Record<string, string>)) {
      output.push(`- \`npm run ${script}\` - ${command}`);
    }
    output.push('');
  }

  // API section placeholder
  output.push('## API');
  output.push('');
  output.push('_See [API Documentation](./docs/api.md) for detailed information._');
  output.push('');

  // License
  if (pkg.license) {
    output.push('## License');
    output.push('');
    output.push(`This project is licensed under the ${pkg.license} License.`);
    output.push('');
  }

  return output.join('\n');
}

async function generateApiDocs(input: string, options: DocArgs['options']): Promise<string> {
  const absPath = path.resolve(process.cwd(), input);

  if (!fs.existsSync(absPath)) {
    return `Error: Path not found: ${absPath}`;
  }

  const content = fs.readFileSync(absPath, 'utf-8');

  // Look for Express/Fastify route patterns
  const routePatterns = [
    /(?:app|router)\.(get|post|put|patch|delete|options|head)\s*\(\s*['"`]([^'"`]+)['"`]/g,
    /@(Get|Post|Put|Patch|Delete|Options|Head)\s*\(\s*['"`]?([^'"`)\s]*)['"`]?\s*\)/g
  ];

  interface Route {
    method: string;
    path: string;
    line: number;
  }

  const routes: Route[] = [];

  for (const pattern of routePatterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const lineNum = content.substring(0, match.index).split('\n').length;
      routes.push({
        method: match[1].toUpperCase(),
        path: match[2] || '/',
        line: lineNum
      });
    }
  }

  if (routes.length === 0) {
    return 'No API routes found in the file. Supported patterns: Express (app.get, router.post, etc.) and decorators (@Get, @Post, etc.)';
  }

  const output: string[] = [];
  output.push('# API Endpoints');
  output.push('');
  output.push(`Found ${routes.length} endpoint(s) in ${path.basename(input)}`);
  output.push('');

  // Group by method
  const byMethod = new Map<string, Route[]>();
  for (const route of routes) {
    if (!byMethod.has(route.method)) {
      byMethod.set(route.method, []);
    }
    byMethod.get(route.method)!.push(route);
  }

  for (const [method, methodRoutes] of byMethod) {
    output.push(`## ${method}`);
    output.push('');

    for (const route of methodRoutes) {
      output.push(`### \`${method} ${route.path}\``);
      output.push('');
      output.push(`_Line ${route.line}_`);
      output.push('');
      output.push('**Request:**');
      output.push('```');
      output.push(`${method} ${route.path}`);
      output.push('```');
      output.push('');
      output.push('**Response:**');
      output.push('```json');
      output.push('// TODO: Document response');
      output.push('```');
      output.push('');
    }
  }

  return output.join('\n');
}

async function generateModuleDocs(input: string, options: DocArgs['options']): Promise<string> {
  const absPath = path.resolve(process.cwd(), input);

  if (!fs.existsSync(absPath)) {
    return `Error: Path not found: ${absPath}`;
  }

  const content = fs.readFileSync(absPath, 'utf-8');
  const fileName = path.basename(absPath);

  const output: string[] = [];
  output.push(`# ${fileName}`);
  output.push('');

  // Extract module-level comment
  const moduleComment = content.match(/^\/\*\*\s*([\s\S]*?)\s*\*\//);
  if (moduleComment) {
    const desc = moduleComment[1].split('\n').map(l => l.replace(/^\s*\*\s?/, '')).join('\n').trim();
    output.push(desc);
    output.push('');
  }

  // Extract exports
  const exports: { name: string; type: string; line: number }[] = [];

  // Named exports
  const namedExportRegex = /export\s+(async\s+)?(function|class|interface|type|const|let|var|enum)\s+(\w+)/g;
  let match;
  while ((match = namedExportRegex.exec(content)) !== null) {
    const lineNum = content.substring(0, match.index).split('\n').length;
    exports.push({
      name: match[3],
      type: match[2],
      line: lineNum
    });
  }

  // Default export
  const defaultMatch = content.match(/export\s+default\s+(?:class|function)?\s*(\w+)?/);
  if (defaultMatch) {
    exports.push({
      name: defaultMatch[1] || 'default',
      type: 'default export',
      line: content.substring(0, defaultMatch.index).split('\n').length
    });
  }

  if (exports.length > 0) {
    output.push('## Exports');
    output.push('');
    output.push('| Name | Type | Line |');
    output.push('|------|------|------|');
    for (const exp of exports) {
      output.push(`| \`${exp.name}\` | ${exp.type} | ${exp.line} |`);
    }
    output.push('');
  }

  // Extract imports
  const imports: { from: string; items: string[] }[] = [];
  const importRegex = /import\s+(?:(?:(\w+)(?:\s*,\s*)?)?(?:\{([^}]+)\})?(?:\*\s+as\s+(\w+))?)\s*from\s*['"]([^'"]+)['"]/g;

  while ((match = importRegex.exec(content)) !== null) {
    const items: string[] = [];
    if (match[1]) items.push(match[1]);
    if (match[2]) items.push(...match[2].split(',').map(s => s.trim()));
    if (match[3]) items.push(`* as ${match[3]}`);

    imports.push({
      from: match[4],
      items
    });
  }

  if (imports.length > 0) {
    output.push('## Dependencies');
    output.push('');
    for (const imp of imports) {
      output.push(`- \`${imp.from}\`: ${imp.items.join(', ')}`);
    }
    output.push('');
  }

  // JSDoc entries
  const jsdocEntries = parseJSDocComments(content).filter(e => e.exported);
  if (jsdocEntries.length > 0) {
    output.push('## API Reference');
    output.push('');

    for (const entry of jsdocEntries) {
      output.push(`### ${entry.name}`);
      output.push('');
      output.push(`_${entry.type}_ | Line ${entry.line}`);
      output.push('');

      if (entry.description) {
        output.push(entry.description);
        output.push('');
      }

      if (entry.params && entry.params.length > 0) {
        output.push('**Parameters:**');
        for (const p of entry.params) {
          output.push(`- \`${p.name}\` (${p.type}): ${p.description}`);
        }
        output.push('');
      }

      if (entry.returns) {
        output.push(`**Returns:** \`${entry.returns.type}\` - ${entry.returns.description}`);
        output.push('');
      }
    }
  }

  return output.join('\n');
}
