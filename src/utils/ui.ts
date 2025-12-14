// src/utils/ui.ts
/**
 * Agent UI Module
 * Handles terminal rendering, spinners, and user interaction.
 * Matrix-themed with green color scheme.
 *
 * Optimized for minimal cursor lag using:
 * - Single-line spinner updates during THINKING (no full box redraw)
 * - Aggressive content caching to skip unnecessary renders
 * - Double-buffering: build complete frame before single stdout.write()
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

/** Throttle interval for content changes */
const MIN_RENDER_INTERVAL_MS = 100;
/** Higher throttle for spinner/message cycling to reduce terminal load */
const SPINNER_THROTTLE_MS = 500;

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
  private lastRenderTime: number = 0;

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
    // Finalize logUpdate output - this is critical for releasing terminal control
    logUpdate.done();
    // Use readline methods for proper cursor control (more reliable than raw ANSI)
    if (process.stdout.isTTY) {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
    }
    this.showCursor();
    // Small delay to ensure terminal state is fully released before inquirer takes over
    // This prevents cursor lag by ensuring log-update is completely done
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
   * Restores terminal to normal state.
   * NOTE: We deliberately do NOT manipulate raw mode here.
   * Let inquirer manage stdin/raw mode to avoid cursor lag conflicts.
   */
  private restoreTerminal(): void {
    // Use readline for reliable cursor positioning
    if (process.stdout.isTTY) {
      // Move to new line and reset cursor
      process.stdout.write('\n');
      readline.cursorTo(process.stdout, 0);
    } else {
      process.stdout.write('\n');
    }
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
    // Allow CI/automation override
    const autoApprove = process.env.NEO_AUTO_APPROVE;
    if (autoApprove && autoApprove !== '0' && autoApprove.toLowerCase() !== 'false') {
      return true;
    }
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
   * Optimized for minimal cursor lag:
   * - THINKING uses simple single-line format (no box) for faster updates
   * - EXECUTING uses full box only when content changes
   * - Higher throttle during spinner-only changes
   */
  private render(): void {
    const now = Date.now();
    const { status, tool, source, args, output, step } = this.state;
    const spinner = this.frames[this.frameIndex];

    // Create cache key for content
    // THINKING: only track step changes (messages are cosmetic)
    // EXECUTING: track tool, args, and output changes
    const contentKey = status === 'THINKING'
      ? `THINKING:${step}`  // Message changes are cosmetic, throttled more
      : `EXEC:${tool}:${args}:${output}`;

    const isSpinnerOnlyChange = this.lastRenderContent === contentKey;

    // Apply different throttling: higher for spinner-only, lower for content changes
    const throttleMs = isSpinnerOnlyChange ? SPINNER_THROTTLE_MS : MIN_RENDER_INTERVAL_MS;
    if (now - this.lastRenderTime < throttleMs) {
      return;
    }

    this.lastRenderContent = contentKey;
    this.lastRenderTime = now;

    // Build the frame in memory (double-buffering)
    let frame: string;
    const coloredSpinner = chalk.greenBright(spinner);

    if (status === 'THINKING') {
      // OPTIMIZED: Simple single-line format - much less ANSI overhead than boxen
      const header = chalk.green(`── NEO [Step ${step}] ──`);
      const message = chalk.green(this.getCurrentMessage());
      frame = `${header} ${coloredSpinner} ${message}`;
    } else if (status === 'EXECUTING') {
      // Full box for execution (content changes are less frequent here)
      let coloredContent = `${coloredSpinner} ${chalk.bold.greenBright('Action:')} ${chalk.greenBright(tool)} ${chalk.green.dim(`(${source})`)}\n` +
        `   ${chalk.green.dim('Input:')}  ${chalk.green(args)}`;
      if (output) {
        coloredContent += `\n   ${chalk.green.dim('Result:')} ${chalk.green(output)}`;
      }

      frame = boxen(coloredContent, {
        padding: 0,
        margin: 0,
        borderStyle: 'round',
        borderColor: 'green',
        title: ` NEO AGENT [Step ${step}] `,
        titleAlignment: 'center',
        width: this.boxWidth
      });
    } else {
      return; // Don't render IDLE or WAITING_APPROVAL
    }

    // Single write to stdout via logUpdate
    logUpdate(frame);
  }

  /**
   * Clears render state for fresh start.
   */
  private clearRenderState(): void {
    this.lastRenderContent = '';
    this.lastRenderTime = 0;
  }
}
