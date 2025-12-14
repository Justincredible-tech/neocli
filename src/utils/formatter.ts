// src/utils/formatter.ts
/**
 * Text Formatter Module
 * Handles word wrapping and terminal output formatting.
 * All output is Matrix green themed.
 */
import chalk from 'chalk';

/**
 * Gets the current terminal width, with fallback.
 * @returns Terminal width in columns
 */
export function getTerminalWidth(): number {
  const width = process.stdout.columns || 80;
  // Leave margin for safety, cap at reasonable max
  return Math.max(40, Math.min(width - 2, 100));
}

/**
 * Wraps text to fit within specified width, preserving words.
 * Simple and fast implementation.
 * @param text - The text to wrap
 * @param width - Maximum line width
 * @returns Wrapped text as array of lines
 */
function wrapLine(text: string, width: number): string[] {
  if (!text || text.length <= width) {
    return [text];
  }

  const words = text.split(/\s+/);
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    if (!word) continue;

    if (currentLine.length === 0) {
      currentLine = word;
    } else if (currentLine.length + 1 + word.length <= width) {
      currentLine += ' ' + word;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines;
}

/**
 * Formats the agent's response with word wrapping and green color.
 * @param text - The raw response text
 * @returns Formatted green text ready for display
 */
export function formatAgentResponse(text: string): string {
  if (!text) return '';

  const width = getTerminalWidth();
  const inputLines = text.split('\n');
  const outputLines: string[] = [];

  for (const line of inputLines) {
    const trimmed = line.trim();

    // Empty lines - preserve them for paragraph breaks
    if (trimmed === '') {
      outputLines.push('');
      continue;
    }

    // Wrap long lines
    const wrapped = wrapLine(trimmed, width);
    outputLines.push(...wrapped);
  }

  // Apply green color to ALL text
  return outputLines.map(line => chalk.green(line)).join('\n');
}

/**
 * Creates the formatted header for agent response.
 * @returns Formatted header string
 */
function createHeader(): string {
  const width = Math.min(getTerminalWidth(), 60);
  const line = chalk.green.dim('─'.repeat(width));
  return '\n' + line + '\n' + chalk.greenBright.bold('Neo:') + '\n';
}

/**
 * Creates the formatted footer for agent response.
 * @returns Formatted footer string
 */
function createFooter(): string {
  const width = Math.min(getTerminalWidth(), 60);
  return '\n' + chalk.green.dim('─'.repeat(width));
}

/**
 * Formats a complete agent response with header, wrapped body, and footer.
 * All text is Matrix green.
 * @param text - The response text
 * @returns Fully formatted green response
 */
export function formatCompleteResponse(text: string): string {
  if (!text) return '';

  const header = createHeader();
  const body = formatAgentResponse(text);
  const footer = createFooter();

  return header + body + footer;
}

export default {
  getTerminalWidth,
  formatAgentResponse,
  formatCompleteResponse,
};
