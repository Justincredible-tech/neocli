// src/utils/tree.ts
/**
 * Matrix-themed file tree visualizer.
 * Icons and green styling for directory structures.
 */

import chalk from 'chalk';
import fs from 'fs';
import path from 'path';

export interface TreeOptions {
  /** Maximum depth to traverse (default: 4) */
  maxDepth?: number;
  /** Show hidden files/folders (default: false) */
  showHidden?: boolean;
  /** Directories to ignore */
  ignore?: string[];
  /** Show file sizes (default: false) */
  showSize?: boolean;
  /** Use icons (default: true) */
  useIcons?: boolean;
  /** Only show directories (default: false) */
  directoriesOnly?: boolean;
}

interface TreeNode {
  name: string;
  isDirectory: boolean;
  size?: number;
  children?: TreeNode[];
}

// File type icons
const ICONS: Record<string, string> = {
  folder: '📁',
  folderOpen: '📂',
  typescript: '🔷',
  javascript: '🟨',
  json: '📋',
  markdown: '📝',
  html: '🌐',
  css: '🎨',
  image: '🖼️',
  git: '🔀',
  lock: '🔒',
  config: '⚙️',
  env: '🔐',
  test: '🧪',
  default: '📄'
};

/**
 * Gets the appropriate icon for a file based on its extension.
 */
function getFileIcon(filename: string, isDirectory: boolean): string {
  if (isDirectory) return ICONS.folder;

  const ext = path.extname(filename).toLowerCase();
  const base = path.basename(filename).toLowerCase();

  // Special files
  if (base === '.gitignore' || base === '.git') return ICONS.git;
  if (base.includes('.env')) return ICONS.env;
  if (base.includes('lock')) return ICONS.lock;
  if (base.includes('config') || base.includes('rc')) return ICONS.config;
  if (base.includes('.test.') || base.includes('.spec.')) return ICONS.test;

  // Extensions
  switch (ext) {
    case '.ts':
    case '.tsx':
      return ICONS.typescript;
    case '.js':
    case '.jsx':
    case '.mjs':
    case '.cjs':
      return ICONS.javascript;
    case '.json':
      return ICONS.json;
    case '.md':
    case '.mdx':
      return ICONS.markdown;
    case '.html':
    case '.htm':
      return ICONS.html;
    case '.css':
    case '.scss':
    case '.sass':
    case '.less':
      return ICONS.css;
    case '.png':
    case '.jpg':
    case '.jpeg':
    case '.gif':
    case '.svg':
    case '.webp':
      return ICONS.image;
    default:
      return ICONS.default;
  }
}

/**
 * Formats a file size in human-readable format.
 */
function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/**
 * Builds a tree structure from a directory.
 */
function buildTree(dirPath: string, options: TreeOptions, depth: number = 0): TreeNode | null {
  const {
    maxDepth = 4,
    showHidden = false,
    ignore = ['.git', 'node_modules', 'dist', 'build', 'coverage', '__pycache__'],
    showSize = false,
    directoriesOnly = false
  } = options;

  const name = path.basename(dirPath);

  // Check if should ignore
  if (!showHidden && name.startsWith('.') && depth > 0) return null;
  if (ignore.includes(name)) return null;

  let stats: fs.Stats;
  try {
    stats = fs.statSync(dirPath);
  } catch {
    return null;
  }

  const node: TreeNode = {
    name,
    isDirectory: stats.isDirectory(),
    size: showSize ? stats.size : undefined
  };

  if (stats.isDirectory()) {
    if (depth >= maxDepth) {
      node.children = []; // Truncated
      return node;
    }

    try {
      const entries = fs.readdirSync(dirPath);
      const children: TreeNode[] = [];

      for (const entry of entries.sort()) {
        const childPath = path.join(dirPath, entry);
        const childNode = buildTree(childPath, options, depth + 1);
        if (childNode) {
          if (!directoriesOnly || childNode.isDirectory) {
            children.push(childNode);
          }
        }
      }

      node.children = children;
    } catch {
      node.children = [];
    }
  } else if (directoriesOnly) {
    return null;
  }

  return node;
}

/**
 * Renders a tree node to string lines.
 */
function renderTree(
  node: TreeNode,
  options: TreeOptions,
  prefix: string = '',
  isLast: boolean = true,
  isRoot: boolean = true
): string[] {
  const { useIcons = true, showSize = false } = options;
  const lines: string[] = [];

  // Current node
  const connector = isRoot ? '' : (isLast ? '└── ' : '├── ');
  const icon = useIcons ? getFileIcon(node.name, node.isDirectory) + ' ' : '';
  const nameStr = node.isDirectory ? chalk.green(node.name) : chalk.white(node.name);
  const sizeStr = showSize && !node.isDirectory && node.size !== undefined
    ? chalk.gray(` (${formatSize(node.size)})`)
    : '';

  lines.push(chalk.green(prefix + connector) + icon + nameStr + sizeStr);

  // Children
  if (node.children) {
    const childPrefix = isRoot ? '' : prefix + (isLast ? '    ' : '│   ');

    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      const childIsLast = i === node.children.length - 1;
      const childLines = renderTree(child, options, childPrefix, childIsLast, false);
      lines.push(...childLines);
    }
  }

  return lines;
}

/**
 * Generates a visual tree representation of a directory.
 * @param dirPath - Path to the directory
 * @param options - Display options
 * @returns Formatted tree string
 */
export function fileTree(dirPath: string, options: TreeOptions = {}): string {
  const absolutePath = path.resolve(dirPath);

  if (!fs.existsSync(absolutePath)) {
    return chalk.red(`Directory not found: ${absolutePath}`);
  }

  const stats = fs.statSync(absolutePath);
  if (!stats.isDirectory()) {
    return chalk.red(`Not a directory: ${absolutePath}`);
  }

  const tree = buildTree(absolutePath, options);
  if (!tree) {
    return chalk.gray('(empty or hidden)');
  }

  const lines = renderTree(tree, options);
  return lines.join('\n');
}

/**
 * Creates a tree from a flat list of file paths.
 * @param paths - Array of file paths
 * @param options - Display options
 * @returns Formatted tree string
 */
export function pathsToTree(paths: string[], options: TreeOptions = {}): string {
  const { useIcons = true } = options;

  if (paths.length === 0) {
    return chalk.gray('(no files)');
  }

  // Build virtual tree structure
  interface VirtualNode {
    name: string;
    isDirectory: boolean;
    children: Map<string, VirtualNode>;
  }

  const root: VirtualNode = { name: '.', isDirectory: true, children: new Map() };

  for (const filePath of paths) {
    const parts = filePath.split(/[/\\]/).filter(p => p);
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;

      if (!current.children.has(part)) {
        current.children.set(part, {
          name: part,
          isDirectory: !isLast,
          children: new Map()
        });
      }
      current = current.children.get(part)!;
    }
  }

  // Render virtual tree
  function renderVirtual(node: VirtualNode, prefix: string, isLast: boolean, isRoot: boolean): string[] {
    const lines: string[] = [];
    const connector = isRoot ? '' : (isLast ? '└── ' : '├── ');
    const icon = useIcons ? getFileIcon(node.name, node.isDirectory) + ' ' : '';
    const nameStr = node.isDirectory ? chalk.green(node.name) : chalk.white(node.name);

    if (!isRoot || node.name !== '.') {
      lines.push(chalk.green(prefix + connector) + icon + nameStr);
    }

    const children = Array.from(node.children.values()).sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    const childPrefix = isRoot ? '' : prefix + (isLast ? '    ' : '│   ');

    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const childIsLast = i === children.length - 1;
      lines.push(...renderVirtual(child, childPrefix, childIsLast, false));
    }

    return lines;
  }

  return renderVirtual(root, '', true, true).join('\n');
}
