// src/utils/table.ts
/**
 * Matrix-themed ASCII table formatter.
 * Double-line borders with green styling.
 */

import chalk from 'chalk';

export interface TableOptions {
  /** Column headers */
  headers?: string[];
  /** Column alignments ('left' | 'center' | 'right') */
  align?: ('left' | 'center' | 'right')[];
  /** Minimum column widths */
  minWidths?: number[];
  /** Maximum column widths (truncate with ...) */
  maxWidths?: number[];
  /** Use single-line borders instead of double (default: false) */
  singleBorder?: boolean;
  /** Colorize headers green (default: true) */
  colorHeaders?: boolean;
  /** Add row numbers (default: false) */
  rowNumbers?: boolean;
}

interface BorderChars {
  topLeft: string;
  topRight: string;
  bottomLeft: string;
  bottomRight: string;
  horizontal: string;
  vertical: string;
  topMid: string;
  bottomMid: string;
  leftMid: string;
  rightMid: string;
  midMid: string;
}

const DOUBLE_BORDERS: BorderChars = {
  topLeft: '╔',
  topRight: '╗',
  bottomLeft: '╚',
  bottomRight: '╝',
  horizontal: '═',
  vertical: '║',
  topMid: '╦',
  bottomMid: '╩',
  leftMid: '╠',
  rightMid: '╣',
  midMid: '╬'
};

const SINGLE_BORDERS: BorderChars = {
  topLeft: '┌',
  topRight: '┐',
  bottomLeft: '└',
  bottomRight: '┘',
  horizontal: '─',
  vertical: '│',
  topMid: '┬',
  bottomMid: '┴',
  leftMid: '├',
  rightMid: '┤',
  midMid: '┼'
};

/**
 * Formats data as an ASCII table with Matrix styling.
 * @param data - 2D array of cell values
 * @param options - Table formatting options
 * @returns Formatted table string
 */
export function formatTable(data: (string | number | boolean | null | undefined)[][], options: TableOptions = {}): string {
  const {
    headers,
    align = [],
    minWidths = [],
    maxWidths = [],
    singleBorder = false,
    colorHeaders = true,
    rowNumbers = false
  } = options;

  const borders = singleBorder ? SINGLE_BORDERS : DOUBLE_BORDERS;

  // Convert all data to strings
  let rows = data.map(row => row.map(cell => String(cell ?? '')));

  // Add row numbers if requested
  if (rowNumbers) {
    rows = rows.map((row, i) => [String(i + 1), ...row]);
  }

  // Prepend headers if provided
  let allRows: string[][] = [];
  if (headers) {
    const headerRow = rowNumbers ? ['#', ...headers] : [...headers];
    allRows = [headerRow, ...rows];
  } else {
    allRows = rows;
  }

  if (allRows.length === 0) {
    return chalk.gray('(empty table)');
  }

  // Calculate column count
  const colCount = Math.max(...allRows.map(r => r.length));

  // Normalize row lengths
  allRows = allRows.map(row => {
    while (row.length < colCount) row.push('');
    return row;
  });

  // Calculate column widths
  const colWidths: number[] = [];
  for (let col = 0; col < colCount; col++) {
    let maxLen = 0;
    for (const row of allRows) {
      maxLen = Math.max(maxLen, stripAnsi(row[col]).length);
    }

    // Apply min/max constraints
    const minW = minWidths[col] ?? 1;
    const maxW = maxWidths[col] ?? Infinity;
    colWidths[col] = Math.max(minW, Math.min(maxW, maxLen));
  }

  // Truncate cells that exceed max width
  allRows = allRows.map(row =>
    row.map((cell, col) => {
      const maxW = maxWidths[col];
      if (maxW && stripAnsi(cell).length > maxW) {
        return cell.substring(0, maxW - 3) + '...';
      }
      return cell;
    })
  );

  // Helper to pad cell content
  const padCell = (content: string, width: number, alignment: 'left' | 'center' | 'right'): string => {
    const len = stripAnsi(content).length;
    const pad = width - len;
    if (pad <= 0) return content;

    switch (alignment) {
      case 'right':
        return ' '.repeat(pad) + content;
      case 'center': {
        const leftPad = Math.floor(pad / 2);
        const rightPad = pad - leftPad;
        return ' '.repeat(leftPad) + content + ' '.repeat(rightPad);
      }
      default:
        return content + ' '.repeat(pad);
    }
  };

  // Build table string
  const lines: string[] = [];

  // Top border
  const topBorder = borders.topLeft +
    colWidths.map(w => borders.horizontal.repeat(w + 2)).join(borders.topMid) +
    borders.topRight;
  lines.push(chalk.green(topBorder));

  // Rows
  for (let rowIdx = 0; rowIdx < allRows.length; rowIdx++) {
    const row = allRows[rowIdx];
    const isHeader = headers && rowIdx === 0;

    const cells = row.map((cell, col) => {
      const alignment = align[col] ?? 'left';
      const padded = padCell(cell, colWidths[col], alignment);
      return isHeader && colorHeaders ? chalk.green(padded) : padded;
    });

    const rowStr = chalk.green(borders.vertical) + ' ' +
      cells.join(` ${chalk.green(borders.vertical)} `) +
      ' ' + chalk.green(borders.vertical);
    lines.push(rowStr);

    // Header separator
    if (isHeader) {
      const separator = borders.leftMid +
        colWidths.map(w => borders.horizontal.repeat(w + 2)).join(borders.midMid) +
        borders.rightMid;
      lines.push(chalk.green(separator));
    }
  }

  // Bottom border
  const bottomBorder = borders.bottomLeft +
    colWidths.map(w => borders.horizontal.repeat(w + 2)).join(borders.bottomMid) +
    borders.bottomRight;
  lines.push(chalk.green(bottomBorder));

  return lines.join('\n');
}

/**
 * Creates a simple key-value table (two columns).
 * @param entries - Object or Map of key-value pairs
 * @param title - Optional title for the table
 * @returns Formatted key-value table string
 */
export function keyValueTable(entries: Record<string, unknown> | Map<string, unknown>, title?: string): string {
  const data: [string, string][] = [];

  if (entries instanceof Map) {
    for (const [key, value] of entries) {
      data.push([key, String(value)]);
    }
  } else {
    for (const [key, value] of Object.entries(entries)) {
      data.push([key, String(value)]);
    }
  }

  const headers = title ? [title, 'Value'] : ['Key', 'Value'];
  return formatTable(data, { headers, align: ['left', 'left'] });
}

/**
 * Strip ANSI escape codes from a string.
 */
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\u001b\[[0-9;]*m/g, '');
}
