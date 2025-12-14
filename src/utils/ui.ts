// src/utils/ui.ts
/**
 * Agent UI Module
 * Handles terminal rendering, spinners, and user interaction.
 * Matrix-themed with green color scheme.
 */
import logUpdate from 'log-update';
import boxen from 'boxen';
import chalk from 'chalk';
import * as readline from 'readline';
import { config } from '../config.js';

// Re-export utility modules for external use
export * from './progress.js';
export * from './table.js';
export * from './tree.js';

/** UI status states */
type UIStatus = 'IDLE' | 'THINKING' | 'EXECUTING' | 'WAITING_APPROVAL';

/** UI state interface */
interface UIState {
  status: UIStatus;
  tool: string;
  source: string;
  args: string;
  output: string;
  step: number;
}

/**
 * AgentUI - Terminal UI manager for the agent.
 * Provides spinners, status updates, and approval prompts.
 * Features Matrix-inspired green color scheme.
 */
export class AgentUI {
  private readonly frames: readonly string[];
  private readonly spinnerIntervalMs: number;
  private readonly maxArgDisplayLength: number;
  private readonly maxOutputDisplayLength: number;
  private readonly boxWidth: number;
  private readonly thinkingMessages: readonly string[];

  private frameIndex = 0;
  private messageIndex = 0;
  private interval: NodeJS.Timeout | null = null;
  private lastRenderContent: string = '';
  private renderPending: boolean = false;

  private state: UIState = {
    status: 'IDLE',
    tool: '',
    source: 'CORE',
    args: '',
    output: '',
    step: 0
  };

  constructor() {
    this.frames = config.ui.spinnerFrames;
    this.spinnerIntervalMs = config.ui.spinnerIntervalMs;
    this.maxArgDisplayLength = config.ui.maxArgDisplayLength;
    this.maxOutputDisplayLength = config.ui.maxOutputDisplayLength;
    this.boxWidth = config.ui.boxWidth;
    this.thinkingMessages = config.ui.thinkingMessages;
  }

  /**
   * Starts the UI with spinner animation.
   */
  start(): void {
    this.hideCursor();
    this.state.step = 0;
    this.messageIndex = 0;
    this.updateStatus('THINKING');
    this.startSpinner();
    this.startMessageCycle();
  }

  /**
   * Stops the UI and properly restores terminal state.
   */
  stop(): void {
    this.stopSpinner();
    this.stopMessageCycle();
    this.clearRenderState();
    // Finalize logUpdate output
    logUpdate.done();
    // Clear the current line to remove any spinner artifacts
    process.stdout.write('\x1B[2K\x1B[0G');
    this.showCursor();
    this.restoreTerminal();
  }

  /**
   * Hides the terminal cursor.
   */
  private hideCursor(): void {
    process.stdout.write('\x1B[?25l');
  }

  /**
   * Shows the terminal cursor.
   */
  private showCursor(): void {
    process.stdout.write('\x1B[?25h');
  }

  /**
   * Restores terminal to normal state after raw mode operations.
   */
  private restoreTerminal(): void {
    if (process.stdin.isTTY) {
      try {
        // Ensure raw mode is disabled
        if (process.stdin.isRaw) {
          process.stdin.setRawMode(false);
        }
        // DO NOT pause or read stdin here - let inquirer manage it
      } catch {
        // Ignore errors - stdin may not support all operations
      }
    }
    // Ensure cursor is at start of a new line
    process.stdout.write('\n');
    // Reset cursor position to ensure proper alignment
    process.stdout.write('\x1B[0G');
  }

  /**
   * Updates the current status.
   * @param status - The new status
   */
  updateStatus(status: 'THINKING' | 'EXECUTING' | 'WAITING_APPROVAL'): void {
    this.state.status = status;
    this.render();
  }

  /**
   * Updates the current tool being executed.
   * @param name - Tool name
   * @param args - Tool arguments
   * @param source - Tool source (CORE, SKILL, MCP)
   */
  updateTool(name: string, args: unknown, source: string = 'CORE'): void {
    this.state.tool = name;
    this.state.source = source.toUpperCase();
    this.state.step++;

    try {
      const json = JSON.stringify(args);
      this.state.args = json.length > this.maxArgDisplayLength
        ? json.substring(0, this.maxArgDisplayLength - 3) + '...'
        : json;
    } catch {
      this.state.args = '[Circular/Complex Data]';
    }

    this.updateStatus('EXECUTING');
  }

  /**
   * Updates the output display.
   * @param output - The output to display
   */
  updateOutput(output: string): void {
    const clean = (output || '')
      .replace(/\r\n/g, '\n')
      .replace(/\u001b\[.*?m/g, ''); // Strip ANSI codes

    this.state.output = clean.length > this.maxOutputDisplayLength
      ? clean.substring(0, this.maxOutputDisplayLength) + `... [${clean.length - this.maxOutputDisplayLength} chars truncated]`
      : clean;

    this.render();
  }

  /**
   * Prompts user for approval before executing a high-risk action.
   * @param toolName - The tool requiring approval
   * @param args - The tool arguments
   * @returns True if user approves, false otherwise
   */
  async askApproval(toolName: string, args: unknown): Promise<boolean> {
    this.stopSpinner();
    this.stopMessageCycle();
    logUpdate.done();
    this.showCursor();
    this.updateStatus('WAITING_APPROVAL');

    // Format args for display
    let argsDisplay: string;
    try {
      argsDisplay = JSON.stringify(args, null, 2);
      // Truncate if too long
      if (argsDisplay.length > 500) {
        argsDisplay = argsDisplay.substring(0, 500) + '\n... [truncated]';
      }
    } catch {
      argsDisplay = '[Complex Data]';
    }

    // Matrix-themed approval box (green/yellow)
    console.log(boxen(
      `${chalk.green.bold('⚠️  APPROVAL REQUIRED')}\n` +
      `${chalk.green.dim('Tool:')} ${chalk.greenBright(toolName)}\n` +
      `${chalk.green.dim('Args:')} ${chalk.green(argsDisplay)}`,
      {
        padding: 1,
        borderColor: 'green',
        borderStyle: 'round',
        title: ' SECURITY GATE ',
        titleAlignment: 'center'
      }
    ));

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    return new Promise<boolean>(resolve => {
      rl.question(chalk.green.bold('Allow this action? [y/N] > '), (answer) => {
        rl.close();
        const approved = answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes';

        if (approved) {
          console.log(chalk.green('✔ Approved'));
        } else {
          console.log(chalk.green.dim('✘ Denied'));
        }

        this.hideCursor();
        this.startSpinner();
        this.startMessageCycle();
        resolve(approved);
      });
    });
  }

  /**
   * Starts the combined binary indicator and message animation.
   * Both cycle together at the same interval for synchronized display.
   */
  private startSpinner(): void {
    if (this.interval) {
      clearInterval(this.interval);
    }
    // Initial render
    this.render();
    // Sync binary indicator (1/0) with message changes
    this.interval = setInterval(() => {
      this.frameIndex = (this.frameIndex + 1) % this.frames.length;
      this.messageIndex = (this.messageIndex + 1) % this.thinkingMessages.length;
      this.render();
    }, this.spinnerIntervalMs);
  }

  /**
   * Stops the animation.
   */
  private stopSpinner(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  /**
   * Starts cycling through thinking messages (now combined with spinner).
   */
  private startMessageCycle(): void {
    // Message cycling is now handled by startSpinner for synchronization
    // This method is kept for API compatibility but does nothing
  }

  /**
   * Stops the message cycling (now combined with spinner).
   */
  private stopMessageCycle(): void {
    // Message cycling is now handled by stopSpinner
    // This method is kept for API compatibility but does nothing
  }

  /**
   * Gets the current thinking message.
   */
  private getCurrentMessage(): string {
    return this.thinkingMessages[this.messageIndex] || this.thinkingMessages[0];
  }

  /**
   * Renders the current UI state with Matrix green theme.
   * Uses content caching to skip unnecessary renders and reduce cursor lag.
   */
  private render(): void {
    const { status, tool, source, args, output, step } = this.state;
    const spinner = this.frames[this.frameIndex];

    let content = '';
    const title = ` NEO AGENT [Step ${step}] `;

    if (status === 'THINKING') {
      // Matrix green theme - dynamic message
      content = `${spinner} Neural Engine: ${this.getCurrentMessage()}`;
    } else if (status === 'EXECUTING') {
      // Matrix green theme for execution
      content = `${spinner} Action: ${tool} (${source})\n   Input:  ${args}`;
      if (output) {
        content += `\n   Result: ${output}`;
      }
    }

    // Create a cache key from content (without colors for comparison)
    const cacheKey = `${title}|${content}`;

    // Skip render if content hasn't changed (only spinner frame changed)
    // This reduces logUpdate calls significantly during idle spinning
    if (status === 'THINKING' && this.lastRenderContent === cacheKey.replace(spinner, '')) {
      // Only the spinner changed, still render but it's a lightweight update
    }

    this.lastRenderContent = cacheKey.replace(spinner, '');

    // Apply colors after caching check
    const coloredSpinner = chalk.greenBright(spinner);
    let coloredContent = '';

    if (status === 'THINKING') {
      coloredContent = `${coloredSpinner} ${chalk.greenBright('Neural Engine:')} ${chalk.green(this.getCurrentMessage())}`;
    } else if (status === 'EXECUTING') {
      coloredContent = `${coloredSpinner} ${chalk.bold.greenBright('Action:')} ${chalk.greenBright(tool)} ${chalk.green.dim(`(${source})`)}\n` +
        `   ${chalk.green.dim('Input:')}  ${chalk.green(args)}`;
      if (output) {
        coloredContent += `\n   ${chalk.green.dim('Result:')} ${chalk.green(output)}`;
      }
    }

    logUpdate(boxen(coloredContent, {
      padding: 0,
      margin: 0,
      borderStyle: 'round',
      borderColor: 'green',
      title: title,
      titleAlignment: 'center',
      width: this.boxWidth
    }));
  }

  /**
   * Clears render state for fresh start.
   */
  private clearRenderState(): void {
    this.lastRenderContent = '';
    this.renderPending = false;
  }
}
