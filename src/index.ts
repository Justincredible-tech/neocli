#!/usr/bin/env node
// src/index.ts
/**
 * NeoCLI Entry Point
 * Enterprise Local AI Agent - Self-Evolving & OS-Aware Autonomous Developer
 * Matrix-themed interface with green color scheme.
 *
 * Uses custom lightweight readline input instead of inquirer to prevent cursor lag.
 * See CLICursorLagResearch.docx for technical background.
 */
import { Agent } from './core/agent.js';
import { commands, CommandContext } from './core/commands.js';
import { router } from './core/llm.js';
import { config } from './config.js';
import { logger } from './utils/logger.js';
import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

/** ASCII art boot sequence - Matrix green theme */
const BOOT_ART = `
${chalk.green('~~~~~~~~~~~~~~~~~~~~~~~~~~~')}
${chalk.green.dim('01111110 01100101 01101111 01')}
${chalk.greenBright('███╗')}${chalk.green.dim('010')}${chalk.greenBright('██╗███████╗ ██████╗')}${chalk.green.dim('010')}
${chalk.greenBright('████╗')}${chalk.green.dim('01')}${chalk.greenBright('██║██╔════╝██╔══ ██╗')}${chalk.green.dim('01')}
${chalk.greenBright('██╔██╗')}${chalk.green.dim('0')}${chalk.greenBright('██║█████╗')}${chalk.green.dim('01')}${chalk.greenBright('██║')}${chalk.green.dim('101')}${chalk.greenBright('██║')}${chalk.green.dim('10')}
${chalk.greenBright('██║╚██╗██║██╔══╝')}${chalk.green.dim('10')}${chalk.greenBright('██║')}${chalk.green.dim('010')}${chalk.greenBright('██║')}${chalk.green.dim('01')}
${chalk.greenBright('██║')}${chalk.green.dim('1')}${chalk.greenBright('╚████║███████╗╚██████╔╝')}${chalk.green.dim('10')}
${chalk.greenBright('╚═╝')}${chalk.green.dim('01')}${chalk.greenBright('╚═══╝╚══════╝ ╚═════╝')}${chalk.green.dim('101')}
${chalk.green.dim('1111110 01100101 011011110 10')}
${chalk.green('The choice is yours.')} ${chalk.green.dim('1111110')}
${chalk.green('~~~~~~~~~~~~~~~~~~~~~~~~~~~')}
`;

/** Version display */
const VERSION_LINE = chalk.green.dim(`v${config.app.version} | Type ${chalk.greenBright('/help')} for commands`);

/**
 * Loads project-specific configuration from NEO.md.
 * @returns Project instructions or empty string
 */
function loadProjectConfig(): string {
  const neoMdPath = path.join(process.cwd(), 'NEO.md');
  try {
    if (fs.existsSync(neoMdPath)) {
      const content = fs.readFileSync(neoMdPath, 'utf-8');
      return `\n<PROJECT_CONFIGURATION>\n${content}\n</PROJECT_CONFIGURATION>\n`;
    }
  } catch (e) {
    logger.warn('Failed to load NEO.md', e);
  }
  return '';
}

/**
 * Lightweight input prompt using raw readline.
 * This replaces inquirer to eliminate character-by-character redraw overhead.
 * The prompt is written once, and input is collected without repainting.
 *
 * @param promptText - The prompt to display
 * @returns Promise resolving to user input
 */
function promptInput(promptText: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

    rl.question(promptText, (answer) => {
      rl.close();
      resolve(answer);
    });

    // Handle Ctrl+C gracefully
    rl.on('SIGINT', () => {
      rl.close();
      reject(new Error('User force closed'));
    });

    rl.on('close', () => {
      // Already resolved or rejected
    });
  });
}

/**
 * Ensures terminal is in correct state for input.
 * Minimal operations to avoid interfering with readline.
 */
function resetTerminalState(): void {
  // Show cursor
  process.stdout.write('\x1B[?25h');
}

/**
 * Displays the welcome banner.
 */
async function displayBanner(): Promise<void> {
  console.clear();
  console.log(BOOT_ART);
  console.log(VERSION_LINE);

  // Check Ollama availability
  const ollamaAvailable = await router.isAvailable();
  if (ollamaAvailable) {
    console.log(chalk.green.dim(`Connected to ${config.llm.defaultModel} @ ${config.llm.host}`));
  } else {
    console.log(chalk.yellow('⚠  Ollama not available at ' + config.llm.host));
  }

  // Check for NEO.md
  if (fs.existsSync(path.join(process.cwd(), 'NEO.md'))) {
    console.log(chalk.green.dim('📋 Project config loaded from NEO.md'));
  }

  console.log();
}

/**
 * Parses command line arguments.
 */
function parseArgs(): { prompt?: string; nonInteractive: boolean } {
  const args = process.argv.slice(2);
  let prompt: string | undefined;
  let nonInteractive = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-p' || arg === '--prompt') {
      prompt = args[++i];
      nonInteractive = true;
    } else if (arg === '--non-interactive' || arg === '-n') {
      nonInteractive = true;
    } else if (arg === '--help') {
      console.log(`
NeoCLI - AI-Powered Development Assistant

Usage: neo [options] [prompt]

Options:
  -p, --prompt <text>   Run with a prompt and exit
  -n, --non-interactive Run in non-interactive mode
  --help                Show this help message
  --version             Show version

Examples:
  neo                           Start interactive mode
  neo "explain this codebase"   Run single prompt
  neo -p "fix the bug"          Run prompt and exit
`);
      process.exit(0);
    } else if (arg === '--version') {
      console.log(`NeoCLI v${config.app.version}`);
      process.exit(0);
    } else if (!prompt && !arg.startsWith('-')) {
      prompt = arg;
      nonInteractive = true;
    }
  }

  return { prompt, nonInteractive };
}

/**
 * Main application loop.
 */
async function main(): Promise<void> {
  const agent = new Agent();
  const { prompt: initialPrompt, nonInteractive } = parseArgs();

  // Load project config
  const projectConfig = loadProjectConfig();
  if (projectConfig) {
    agent.setProjectConfig(projectConfig);
  }

  // Display banner for interactive mode
  if (!nonInteractive) {
    await displayBanner();
  }

  // Create command context
  const commandContext: CommandContext = {
    clearHistory: () => agent.clearHistory(),
    getHistory: () => agent.getHistory(),
    setHistory: (history) => agent.setHistory(history),
    getCwd: () => process.cwd(),
    runAgent: async (prompt) => { await agent.run(prompt); },
    getRepoMap: () => agent.getRepoMap(),
    refreshRepoMap: async () => { await agent.refreshMap(); }
  };

  // Handle single prompt mode
  if (initialPrompt) {
    // Check if it's a slash command
    if (commands.isCommand(initialPrompt)) {
      const result = await commands.execute(initialPrompt, commandContext);
      if (result.message) {
        console.log(result.message);
      }
      if (result.continueToAgent && result.modifiedPrompt) {
        await agent.run(result.modifiedPrompt);
      }
    } else {
      await agent.run(initialPrompt);
    }

    if (nonInteractive) {
      process.exit(0);
    }
  }

  // Main REPL loop - uses lightweight readline instead of inquirer for zero cursor lag
  while (true) {
    try {
      resetTerminalState();

      // Use lightweight prompt - single write, no per-keystroke repainting
      const input = await promptInput(chalk.bold.greenBright('Neo > '));
      const trimmedInput = input.trim();
      if (!trimmedInput) continue;

      // Check for exit commands
      const lowerInput = trimmedInput.toLowerCase();
      if (['exit', 'quit', 'q'].includes(lowerInput)) {
        console.log(chalk.green("Disconnecting from the Matrix..."));
        process.exit(0);
      }

      // Check for slash commands
      if (commands.isCommand(trimmedInput)) {
        const result = await commands.execute(trimmedInput, commandContext);
        if (result.message) {
          console.log(result.message);
        }
        if (result.continueToAgent) {
          const prompt = result.modifiedPrompt || trimmedInput;
          await agent.run(prompt);
        }
        continue;
      }

      // Regular agent interaction
      await agent.run(trimmedInput);
      // Terminal state will be reset at top of loop

    } catch (error) {
      resetTerminalState();

      if (error instanceof Error) {
        if (error.message.includes('User force closed') ||
            error.message.includes('canceled')) {
          console.log(chalk.green.dim('\nGoodbye!'));
          process.exit(0);
        }

        logger.error("Main loop error", error);
        console.error(chalk.green("\n[!] Error:"), chalk.greenBright(error.message));
      } else {
        console.error(chalk.green("\n[!] Unknown error occurred"));
      }
    }
  }
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.error("Uncaught exception", error);
  console.error(chalk.green('\n[!] Uncaught Exception:'), chalk.greenBright(error.message));
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error("Unhandled rejection", reason);
  console.error(chalk.green('\n[!] Unhandled Rejection:'), reason);
});

// Start the application
main().catch((error) => {
  logger.error("Fatal startup error", error);
  console.error(chalk.green('Fatal Error:'), error);
  process.exit(1);
});
