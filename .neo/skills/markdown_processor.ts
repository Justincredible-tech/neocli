/* NEO_SKILL_META
{
  "name": "markdown_processor",
  "description": "Parse and process Markdown files. Generate table of contents, extract code blocks, validate links, convert to HTML, and analyze document structure.",
  "argsSchema": {
    "type": "object",
    "properties": {
      "action": {
        "type": "string",
        "enum": ["toc", "extract_code", "validate_links", "to_html", "structure", "extract_links"],
        "description": "Processing action to perform"
      },
      "input": { "type": "string", "description": "Markdown content or file path" },
      "options": {
        "type": "object",
        "properties": {
          "maxDepth": { "type": "number", "description": "Maximum heading depth for TOC (default: 3)" },
          "language": { "type": "string", "description": "Filter code blocks by language" },
          "numbered": { "type": "boolean", "description": "Use numbered TOC (default: false)" },
          "includeAnchors": { "type": "boolean", "description": "Include anchor links in TOC (default: true)" }
        }
      }
    },
    "required": ["action", "input"]
  }
}
NEO_SKILL_META */

import fs from 'fs';
import path from 'path';
import { marked } from 'marked';

interface ProcessorArgs {
  action: 'toc' | 'extract_code' | 'validate_links' | 'to_html' | 'structure' | 'extract_links';
  input: string;
  options?: {
    maxDepth?: number;
    language?: string;
    numbered?: boolean;
    includeAnchors?: boolean;
  };
}

interface Heading {
  level: number;
  text: string;
  anchor: string;
  line: number;
}

interface CodeBlock {
  language: string;
  code: string;
  line: number;
}

interface Link {
  text: string;
  url: string;
  type: 'external' | 'internal' | 'anchor' | 'email';
  line: number;
}

export async function run(args: ProcessorArgs): Promise<string> {
  const { action, input, options = {} } = args;

  if (!action || !input) {
    return 'Error: action and input are required';
  }

  // Load content
  let content: string;
  let sourcePath: string | null = null;

  if (!input.includes('\n') && !input.includes('#')) {
    // Might be a file path
    const absPath = path.resolve(process.cwd(), input);
    if (fs.existsSync(absPath)) {
      content = fs.readFileSync(absPath, 'utf-8');
      sourcePath = absPath;
    } else {
      content = input;
    }
  } else {
    content = input;
  }

  try {
    switch (action) {
      case 'toc':
        return generateTOC(content, options);
      case 'extract_code':
        return extractCodeBlocks(content, options);
      case 'validate_links':
        return validateLinks(content, sourcePath);
      case 'to_html':
        return convertToHTML(content);
      case 'structure':
        return analyzeStructure(content);
      case 'extract_links':
        return extractLinks(content);
      default:
        return `Error: Unknown action "${action}"`;
    }
  } catch (e: unknown) {
    return `Error: ${(e as Error).message}`;
  }
}

function parseHeadings(content: string): Heading[] {
  const headings: Heading[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^(#{1,6})\s+(.+)$/);

    if (match) {
      const level = match[1].length;
      const text = match[2].trim();
      const anchor = text
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-');

      headings.push({ level, text, anchor, line: i + 1 });
    }
  }

  return headings;
}

function generateTOC(content: string, options: ProcessorArgs['options']): string {
  const { maxDepth = 3, numbered = false, includeAnchors = true } = options || {};

  const headings = parseHeadings(content).filter(h => h.level <= maxDepth);

  if (headings.length === 0) {
    return 'No headings found in the document.';
  }

  const lines: string[] = [];
  lines.push('=== Table of Contents ===');
  lines.push('');

  const counters: number[] = [0, 0, 0, 0, 0, 0];

  for (const heading of headings) {
    const indent = '  '.repeat(heading.level - 1);

    let prefix = '';
    if (numbered) {
      counters[heading.level - 1]++;
      // Reset lower level counters
      for (let i = heading.level; i < counters.length; i++) {
        counters[i] = 0;
      }

      const nums = counters.slice(0, heading.level).filter(n => n > 0);
      prefix = nums.join('.') + '. ';
    } else {
      prefix = '- ';
    }

    const link = includeAnchors ? `[${heading.text}](#${heading.anchor})` : heading.text;
    lines.push(`${indent}${prefix}${link}`);
  }

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('Markdown TOC (copy-paste ready):');
  lines.push('');
  lines.push('```markdown');
  lines.push('## Table of Contents');
  lines.push('');

  for (const heading of headings) {
    const indent = '  '.repeat(heading.level - 1);
    lines.push(`${indent}- [${heading.text}](#${heading.anchor})`);
  }

  lines.push('```');

  return lines.join('\n');
}

function extractCodeBlocks(content: string, options: ProcessorArgs['options']): string {
  const { language } = options || {};

  const codeBlocks: CodeBlock[] = [];
  const lines = content.split('\n');

  let inCodeBlock = false;
  let currentBlock: CodeBlock | null = null;
  let codeLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('```')) {
      if (!inCodeBlock) {
        // Start of code block
        inCodeBlock = true;
        const lang = line.slice(3).trim() || 'plaintext';
        currentBlock = { language: lang, code: '', line: i + 1 };
        codeLines = [];
      } else {
        // End of code block
        if (currentBlock) {
          currentBlock.code = codeLines.join('\n');
          codeBlocks.push(currentBlock);
        }
        inCodeBlock = false;
        currentBlock = null;
      }
    } else if (inCodeBlock) {
      codeLines.push(line);
    }
  }

  // Filter by language if specified
  const filtered = language
    ? codeBlocks.filter(b => b.language.toLowerCase() === language.toLowerCase())
    : codeBlocks;

  if (filtered.length === 0) {
    return language
      ? `No code blocks found with language "${language}".`
      : 'No code blocks found in the document.';
  }

  const output: string[] = [];
  output.push(`=== Code Blocks (${filtered.length} found) ===`);
  output.push('');

  // Group by language
  const byLanguage = new Map<string, CodeBlock[]>();
  for (const block of filtered) {
    if (!byLanguage.has(block.language)) {
      byLanguage.set(block.language, []);
    }
    byLanguage.get(block.language)!.push(block);
  }

  output.push('Languages:');
  for (const [lang, blocks] of byLanguage) {
    output.push(`  ${lang}: ${blocks.length} block(s)`);
  }
  output.push('');

  for (let i = 0; i < filtered.length; i++) {
    const block = filtered[i];
    output.push(`--- Block ${i + 1} [${block.language}] (line ${block.line}) ---`);
    output.push(block.code.length > 500 ? block.code.substring(0, 500) + '\n... (truncated)' : block.code);
    output.push('');
  }

  return output.join('\n');
}

function parseLinks(content: string): Link[] {
  const links: Link[] = [];
  const lines = content.split('\n');

  // Markdown links: [text](url)
  const linkRegex = /\[([^\]]*)\]\(([^)]+)\)/g;

  // Reference links: [text][ref] and [ref]: url
  const refLinks = new Map<string, string>();
  const refRegex = /^\[([^\]]+)\]:\s*(.+)$/gm;
  let refMatch;

  while ((refMatch = refRegex.exec(content)) !== null) {
    refLinks.set(refMatch[1].toLowerCase(), refMatch[2].trim());
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let match;

    while ((match = linkRegex.exec(line)) !== null) {
      const text = match[1];
      const url = match[2];

      links.push({
        text,
        url,
        type: classifyLink(url),
        line: i + 1
      });
    }

    // Check for reference-style links [text][ref]
    const refLinkRegex = /\[([^\]]+)\]\[([^\]]*)\]/g;
    while ((match = refLinkRegex.exec(line)) !== null) {
      const text = match[1];
      const ref = match[2] || match[1];
      const url = refLinks.get(ref.toLowerCase());

      if (url) {
        links.push({
          text,
          url,
          type: classifyLink(url),
          line: i + 1
        });
      }
    }
  }

  return links;
}

function classifyLink(url: string): 'external' | 'internal' | 'anchor' | 'email' {
  if (url.startsWith('mailto:') || url.includes('@')) {
    return 'email';
  }
  if (url.startsWith('#')) {
    return 'anchor';
  }
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return 'external';
  }
  return 'internal';
}

function validateLinks(content: string, sourcePath: string | null): string {
  const links = parseLinks(content);

  if (links.length === 0) {
    return 'No links found in the document.';
  }

  const headings = parseHeadings(content);
  const anchors = new Set(headings.map(h => h.anchor));

  const output: string[] = [];
  output.push(`=== Link Validation (${links.length} links) ===`);
  output.push('');

  const issues: string[] = [];
  const valid: string[] = [];

  for (const link of links) {
    if (link.type === 'anchor') {
      const anchorName = link.url.slice(1);
      if (!anchors.has(anchorName)) {
        issues.push(`Line ${link.line}: Broken anchor "${link.url}" - heading not found`);
      } else {
        valid.push(`Line ${link.line}: Anchor "${link.url}" -> OK`);
      }
    } else if (link.type === 'internal' && sourcePath) {
      const targetPath = path.resolve(path.dirname(sourcePath), link.url.split('#')[0]);
      if (!fs.existsSync(targetPath)) {
        issues.push(`Line ${link.line}: Broken link "${link.url}" - file not found`);
      } else {
        valid.push(`Line ${link.line}: Internal "${link.url}" -> OK`);
      }
    } else if (link.type === 'external') {
      valid.push(`Line ${link.line}: External "${link.url}" (not checked)`);
    } else if (link.type === 'email') {
      valid.push(`Line ${link.line}: Email "${link.url}"`);
    }
  }

  if (issues.length > 0) {
    output.push(`Found ${issues.length} issue(s):`);
    output.push('');
    for (const issue of issues) {
      output.push(`  ! ${issue}`);
    }
    output.push('');
  }

  output.push(`Valid/Unchecked (${valid.length}):`);
  for (const v of valid.slice(0, 20)) {
    output.push(`  ✓ ${v}`);
  }

  if (valid.length > 20) {
    output.push(`  ... and ${valid.length - 20} more`);
  }

  return output.join('\n');
}

function convertToHTML(content: string): string {
  const html = marked.parse(content);

  const output: string[] = [];
  output.push('=== Markdown to HTML ===');
  output.push('');
  output.push(html as string);

  return output.join('\n');
}

function analyzeStructure(content: string): string {
  const headings = parseHeadings(content);
  const codeBlocks = extractCodeBlocksRaw(content);
  const links = parseLinks(content);
  const lines = content.split('\n');

  // Count various elements
  let listItems = 0;
  let blockquotes = 0;
  let images = 0;
  let tables = 0;
  let emptyLines = 0;

  for (const line of lines) {
    if (/^\s*[-*+]\s/.test(line) || /^\s*\d+\.\s/.test(line)) listItems++;
    if (line.startsWith('>')) blockquotes++;
    if (/!\[.*\]\(.*\)/.test(line)) images++;
    if (/^\|.*\|$/.test(line)) tables++;
    if (line.trim() === '') emptyLines++;
  }

  const output: string[] = [];
  output.push('=== Document Structure ===');
  output.push('');
  output.push('Statistics:');
  output.push(`  Total Lines: ${lines.length}`);
  output.push(`  Empty Lines: ${emptyLines}`);
  output.push(`  Headings: ${headings.length}`);
  output.push(`  Code Blocks: ${codeBlocks}`);
  output.push(`  Links: ${links.length}`);
  output.push(`  Images: ${images}`);
  output.push(`  List Items: ${listItems}`);
  output.push(`  Blockquotes: ${blockquotes}`);
  output.push(`  Table Rows: ${tables}`);
  output.push('');

  output.push('Heading Hierarchy:');
  for (const h of headings) {
    const indent = '  '.repeat(h.level);
    output.push(`${indent}[H${h.level}] ${h.text} (line ${h.line})`);
  }

  // Check structure issues
  output.push('');
  output.push('Structure Analysis:');

  if (headings.length > 0 && headings[0].level !== 1) {
    output.push(`  ! Document should start with H1 (found H${headings[0].level})`);
  }

  // Check for heading level jumps
  for (let i = 1; i < headings.length; i++) {
    const prev = headings[i - 1].level;
    const curr = headings[i].level;
    if (curr > prev + 1) {
      output.push(`  ! Heading level jump: H${prev} -> H${curr} at line ${headings[i].line}`);
    }
  }

  if (!headings.some(h => h.level === 1)) {
    output.push('  ! No H1 heading found');
  }

  const h1Count = headings.filter(h => h.level === 1).length;
  if (h1Count > 1) {
    output.push(`  ! Multiple H1 headings found (${h1Count})`);
  }

  return output.join('\n');
}

function extractCodeBlocksRaw(content: string): number {
  const matches = content.match(/```[\s\S]*?```/g);
  return matches ? matches.length : 0;
}

function extractLinks(content: string): string {
  const links = parseLinks(content);

  if (links.length === 0) {
    return 'No links found in the document.';
  }

  const output: string[] = [];
  output.push(`=== Extracted Links (${links.length}) ===`);
  output.push('');

  // Group by type
  const byType = new Map<string, Link[]>();
  for (const link of links) {
    if (!byType.has(link.type)) {
      byType.set(link.type, []);
    }
    byType.get(link.type)!.push(link);
  }

  for (const [type, typeLinks] of byType) {
    output.push(`${type.toUpperCase()} (${typeLinks.length}):`);
    for (const link of typeLinks) {
      output.push(`  Line ${link.line}: [${link.text}](${link.url})`);
    }
    output.push('');
  }

  return output.join('\n');
}
