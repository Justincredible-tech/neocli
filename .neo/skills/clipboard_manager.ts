/* NEO_SKILL_META
{
  "name": "clipboard_manager",
  "description": "Manage clipboard operations: read/write system clipboard, maintain history, and insert code templates. Cross-platform support.",
  "argsSchema": {
    "type": "object",
    "properties": {
      "action": {
        "type": "string",
        "enum": ["read", "write", "history", "template", "clear"],
        "description": "Clipboard action to perform"
      },
      "content": { "type": "string", "description": "Content to write to clipboard" },
      "options": {
        "type": "object",
        "properties": {
          "template": { "type": "string", "description": "Template name to insert" },
          "variables": { "type": "object", "description": "Variables for template substitution" },
          "format": { "type": "string", "enum": ["text", "json", "code"], "description": "Content format" }
        }
      }
    },
    "required": ["action"]
  }
}
NEO_SKILL_META */

import { execSync, spawnSync } from 'child_process';
import os from 'os';

interface ClipboardArgs {
  action: 'read' | 'write' | 'history' | 'template' | 'clear';
  content?: string;
  options?: {
    template?: string;
    variables?: Record<string, string>;
    format?: 'text' | 'json' | 'code';
  };
}

// Clipboard history (in-memory for session)
const clipboardHistory: { content: string; timestamp: number }[] = [];
const MAX_HISTORY = 10;

// Code templates
const TEMPLATES: Record<string, string> = {
  // TypeScript templates
  ts_function: `export function {{name}}({{params}}): {{returnType}} {
  {{body}}
}`,

  ts_async_function: `export async function {{name}}({{params}}): Promise<{{returnType}}> {
  try {
    {{body}}
  } catch (error) {
    throw error;
  }
}`,

  ts_interface: `export interface {{name}} {
  {{properties}}
}`,

  ts_class: `export class {{name}} {
  constructor({{params}}) {
    {{init}}
  }

  {{methods}}
}`,

  ts_test: `describe('{{name}}', () => {
  beforeEach(() => {
    // Setup
  });

  it('should {{description}}', () => {
    // Arrange
    {{arrange}}

    // Act
    {{act}}

    // Assert
    {{assert}}
  });
});`,

  // React templates
  react_component: `import React from 'react';

interface {{name}}Props {
  {{props}}
}

export const {{name}}: React.FC<{{name}}Props> = ({ {{destructuredProps}} }) => {
  return (
    <div>
      {{content}}
    </div>
  );
};`,

  react_hook: `import { useState, useEffect } from 'react';

export function use{{name}}({{params}}) {
  const [{{state}}, set{{State}}] = useState({{initialValue}});

  useEffect(() => {
    {{effect}}
  }, [{{deps}}]);

  return { {{returns}} };
}`,

  // Express templates
  express_route: `import { Router, Request, Response } from 'express';

const router = Router();

router.get('{{path}}', async (req: Request, res: Response) => {
  try {
    {{handler}}
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;`,

  // Documentation templates
  jsdoc_function: `/**
 * {{description}}
 * @param {{paramName}} - {{paramDescription}}
 * @returns {{returnDescription}}
 * @example
 * {{example}}
 */`,

  readme_section: `## {{title}}

{{description}}

### Installation

\`\`\`bash
{{installation}}
\`\`\`

### Usage

\`\`\`{{language}}
{{usage}}
\`\`\``,

  // Git templates
  commit_conventional: `{{type}}({{scope}}): {{subject}}

{{body}}

{{footer}}`,

  pr_template: `## Summary
{{summary}}

## Changes
- {{change1}}
- {{change2}}

## Testing
- [ ] Unit tests
- [ ] Integration tests
- [ ] Manual testing

## Screenshots
{{screenshots}}`,

  // Utility templates
  error_handler: `try {
  {{code}}
} catch (error) {
  if (error instanceof {{ErrorType}}) {
    {{specificHandler}}
  } else {
    console.error('Unexpected error:', error);
    throw error;
  }
}`,

  fetch_request: `const response = await fetch('{{url}}', {
  method: '{{method}}',
  headers: {
    'Content-Type': 'application/json',
    {{headers}}
  },
  body: JSON.stringify({{body}})
});

if (!response.ok) {
  throw new Error(\`HTTP error! status: \${response.status}\`);
}

const data = await response.json();`,

  env_config: `{{envVar}}={{value}}  # {{description}}`
};

export async function run(args: ClipboardArgs): Promise<string> {
  const { action, content, options = {} } = args;

  if (!action) {
    return 'Error: action is required';
  }

  try {
    switch (action) {
      case 'read':
        return readClipboard();
      case 'write':
        return writeClipboard(content, options);
      case 'history':
        return showHistory();
      case 'template':
        return insertTemplate(options);
      case 'clear':
        return clearClipboard();
      default:
        return `Error: Unknown action "${action}"`;
    }
  } catch (e: unknown) {
    return `Error: ${(e as Error).message}`;
  }
}

function getClipboardCommand(): { read: string[]; write: string[] } {
  const platform = os.platform();

  switch (platform) {
    case 'darwin':
      return {
        read: ['pbpaste'],
        write: ['pbcopy']
      };
    case 'win32':
      return {
        read: ['powershell', '-command', 'Get-Clipboard'],
        write: ['clip']
      };
    case 'linux':
      // Try xclip first, fall back to xsel
      return {
        read: ['xclip', '-selection', 'clipboard', '-o'],
        write: ['xclip', '-selection', 'clipboard']
      };
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

function readClipboard(): string {
  const platform = os.platform();

  try {
    let content: string;

    if (platform === 'darwin') {
      content = execSync('pbpaste', { encoding: 'utf-8' });
    } else if (platform === 'win32') {
      content = execSync('powershell -command "Get-Clipboard"', { encoding: 'utf-8' });
    } else {
      // Linux - try xclip first
      try {
        content = execSync('xclip -selection clipboard -o', { encoding: 'utf-8' });
      } catch {
        content = execSync('xsel --clipboard --output', { encoding: 'utf-8' });
      }
    }

    // Add to history
    addToHistory(content);

    const output: string[] = [];
    output.push('=== Clipboard Content ===');
    output.push('');
    output.push(`Length: ${content.length} characters`);
    output.push(`Lines: ${content.split('\n').length}`);
    output.push('');
    output.push('Content:');
    output.push(content.length > 2000 ? content.substring(0, 2000) + '\n... (truncated)' : content);

    return output.join('\n');
  } catch (e: unknown) {
    return `Error reading clipboard: ${(e as Error).message}. Make sure clipboard tools are installed (xclip on Linux).`;
  }
}

function writeClipboard(content: string | undefined, options: ClipboardArgs['options']): string {
  if (!content) {
    return 'Error: content is required for write action';
  }

  const { format } = options || {};

  // Format content if needed
  let formattedContent = content;
  if (format === 'json') {
    try {
      const parsed = JSON.parse(content);
      formattedContent = JSON.stringify(parsed, null, 2);
    } catch {
      // Keep original if not valid JSON
    }
  }

  const platform = os.platform();

  try {
    if (platform === 'darwin') {
      const result = spawnSync('pbcopy', { input: formattedContent, encoding: 'utf-8' });
      if (result.error) throw result.error;
    } else if (platform === 'win32') {
      const result = spawnSync('clip', { input: formattedContent, encoding: 'utf-8', shell: true });
      if (result.error) throw result.error;
    } else {
      // Linux
      try {
        const result = spawnSync('xclip', ['-selection', 'clipboard'], { input: formattedContent, encoding: 'utf-8' });
        if (result.error) throw result.error;
      } catch {
        const result = spawnSync('xsel', ['--clipboard', '--input'], { input: formattedContent, encoding: 'utf-8' });
        if (result.error) throw result.error;
      }
    }

    // Add to history
    addToHistory(formattedContent);

    const output: string[] = [];
    output.push('=== Written to Clipboard ===');
    output.push('');
    output.push(`Length: ${formattedContent.length} characters`);
    output.push(`Format: ${format || 'text'}`);
    output.push('');
    output.push('Preview:');
    output.push(formattedContent.length > 500 ? formattedContent.substring(0, 500) + '\n... (truncated)' : formattedContent);

    return output.join('\n');
  } catch (e: unknown) {
    return `Error writing to clipboard: ${(e as Error).message}`;
  }
}

function addToHistory(content: string): void {
  // Don't add duplicates of the last item
  if (clipboardHistory.length > 0 && clipboardHistory[0].content === content) {
    return;
  }

  clipboardHistory.unshift({
    content,
    timestamp: Date.now()
  });

  // Trim history
  while (clipboardHistory.length > MAX_HISTORY) {
    clipboardHistory.pop();
  }
}

function showHistory(): string {
  const output: string[] = [];
  output.push('=== Clipboard History ===');
  output.push('');

  if (clipboardHistory.length === 0) {
    output.push('No clipboard history available.');
    output.push('');
    output.push('History is collected during this session when you read/write the clipboard.');
    return output.join('\n');
  }

  for (let i = 0; i < clipboardHistory.length; i++) {
    const entry = clipboardHistory[i];
    const timeAgo = formatTimeAgo(new Date(entry.timestamp));
    const preview = entry.content.substring(0, 50).replace(/\n/g, '\\n');

    output.push(`${i + 1}. [${timeAgo}] "${preview}${entry.content.length > 50 ? '...' : ''}"`);
  }

  output.push('');
  output.push(`Total: ${clipboardHistory.length} items`);

  return output.join('\n');
}

function insertTemplate(options: ClipboardArgs['options']): string {
  const { template, variables = {} } = options || {};

  if (!template) {
    // List available templates
    const output: string[] = [];
    output.push('=== Available Templates ===');
    output.push('');

    const categories: Record<string, string[]> = {
      'TypeScript': ['ts_function', 'ts_async_function', 'ts_interface', 'ts_class', 'ts_test'],
      'React': ['react_component', 'react_hook'],
      'Express': ['express_route'],
      'Documentation': ['jsdoc_function', 'readme_section'],
      'Git': ['commit_conventional', 'pr_template'],
      'Utility': ['error_handler', 'fetch_request', 'env_config']
    };

    for (const [category, templates] of Object.entries(categories)) {
      output.push(`${category}:`);
      for (const t of templates) {
        output.push(`  - ${t}`);
      }
      output.push('');
    }

    output.push('Usage: Set options.template to one of these names.');
    return output.join('\n');
  }

  const templateContent = TEMPLATES[template];
  if (!templateContent) {
    return `Error: Template "${template}" not found. Use action "template" without options to see available templates.`;
  }

  // Substitute variables
  let result = templateContent;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`{{${key}}}`, 'g'), value);
  }

  // Find remaining placeholders
  const remaining = result.match(/{{(\w+)}}/g);
  if (remaining && remaining.length > 0) {
    const placeholders = [...new Set(remaining)].map(p => p.replace(/{{|}}/g, ''));

    const output: string[] = [];
    output.push(`=== Template: ${template} ===`);
    output.push('');
    output.push('Template requires these variables:');
    for (const p of placeholders) {
      output.push(`  - ${p}`);
    }
    output.push('');
    output.push('Template preview:');
    output.push(result);

    return output.join('\n');
  }

  // Write to clipboard
  return writeClipboard(result, { format: 'code' });
}

function clearClipboard(): string {
  const platform = os.platform();

  try {
    if (platform === 'darwin') {
      execSync('pbcopy < /dev/null');
    } else if (platform === 'win32') {
      execSync('echo. | clip', { shell: true });
    } else {
      try {
        execSync('echo -n | xclip -selection clipboard');
      } catch {
        execSync('echo -n | xsel --clipboard --input');
      }
    }

    return 'Clipboard cleared.';
  } catch (e: unknown) {
    return `Error clearing clipboard: ${(e as Error).message}`;
  }
}

function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
