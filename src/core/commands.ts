// src/core/commands.ts
/**
 * Slash Command System
 * Implements extensible slash commands similar to Claude Code, Gemini CLI, and Codex.
 */
import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { router } from './llm.js';
import { registry } from '../tools/registry.js';

/** Command handler function type */
type CommandHandler = (args: string, context: CommandContext) => Promise<CommandResult>;

/** Context passed to command handlers */
export interface CommandContext {
  /** Clear conversation history */
  clearHistory: () => void;
  /** Get current conversation history */
  getHistory: () => string[];
  /** Set conversation history */
  setHistory: (history: string[]) => void;
  /** Get current working directory */
  getCwd: () => string;
  /** Trigger agent run with a prompt */
  runAgent: (prompt: string) => Promise<void>;
  /** Get repo map */
  getRepoMap: () => string;
  /** Refresh repo map */
  refreshRepoMap: () => Promise<void>;
}

/** Result of command execution */
export interface CommandResult {
  /** Whether to continue to agent (false = command handled it) */
  continueToAgent: boolean;
  /** Optional message to display */
  message?: string;
  /** Optional modified prompt to send to agent */
  modifiedPrompt?: string;
}

/** Slash command definition */
interface SlashCommand {
  name: string;
  aliases: string[];
  description: string;
  usage: string;
  handler: CommandHandler;
}

/**
 * CommandRegistry - Manages slash commands.
 */
class CommandRegistry {
  private commands: Map<string, SlashCommand> = new Map();
  private customCommandsDir: string;

  constructor() {
    this.customCommandsDir = path.join(process.cwd(), '.neo', 'commands');
    this.registerBuiltinCommands();
  }

  /**
   * Registers all built-in commands.
   */
  private registerBuiltinCommands(): void {
    // /help - Show available commands
    this.register({
      name: 'help',
      aliases: ['h', '?'],
      description: 'Show available commands and their usage',
      usage: '/help [command]',
      handler: async (args) => {
        if (args) {
          const cmd = this.commands.get(args) || this.findByAlias(args);
          if (cmd) {
            return {
              continueToAgent: false,
              message: this.formatCommandHelp(cmd)
            };
          }
          return {
            continueToAgent: false,
            message: chalk.yellow(`Unknown command: ${args}`)
          };
        }
        return {
          continueToAgent: false,
          message: this.formatAllHelp()
        };
      }
    });

    // /clear - Clear conversation context
    this.register({
      name: 'clear',
      aliases: ['c', 'reset'],
      description: 'Clear conversation history and context',
      usage: '/clear',
      handler: async (_args, context) => {
        context.clearHistory();
        return {
          continueToAgent: false,
          message: chalk.green('✓ Conversation cleared. Starting fresh.')
        };
      }
    });

    // /compact - Summarize conversation to save context
    this.register({
      name: 'compact',
      aliases: ['summarize'],
      description: 'Summarize conversation history to save context tokens',
      usage: '/compact',
      handler: async (_args, context) => {
        const history = context.getHistory();
        if (history.length < 4) {
          return {
            continueToAgent: false,
            message: chalk.yellow('Not enough conversation history to compact.')
          };
        }

        try {
          const summaryPrompt = `Summarize the following conversation into key points and context that should be preserved. Be concise but capture all important details, decisions made, and current state:\n\n${history.join('\n')}`;

          const summary = await router.generate(summaryPrompt, 'You are a helpful assistant that summarizes conversations concisely.');

          context.setHistory([`[Previous Session Summary]: ${summary}`]);

          return {
            continueToAgent: false,
            message: chalk.green(`✓ Conversation compacted. Reduced ${history.length} entries to summary.`)
          };
        } catch (e) {
          return {
            continueToAgent: false,
            message: chalk.red(`Failed to compact: ${(e as Error).message}`)
          };
        }
      }
    });

    // /status - Show system status
    this.register({
      name: 'status',
      aliases: ['s', 'info'],
      description: 'Show system status and configuration',
      usage: '/status',
      handler: async () => {
        const ollamaAvailable = await router.isAvailable();
        const tools = await registry.getAvailableTools();
        const coreTools = tools.filter(t => t.source === 'CORE').length;
        const skills = tools.filter(t => t.source === 'SKILL').length;

        const status = `
${chalk.green.bold('System Status')}
${chalk.green('─'.repeat(40))}
  ${chalk.green.dim('Version:')}      ${chalk.greenBright(config.app.version)}
  ${chalk.green.dim('Model:')}        ${chalk.greenBright(config.llm.defaultModel)}
  ${chalk.green.dim('Ollama:')}       ${ollamaAvailable ? chalk.greenBright('Connected') : chalk.red('Disconnected')}
  ${chalk.green.dim('Host:')}         ${chalk.greenBright(config.llm.host)}
  ${chalk.green.dim('Core Tools:')}   ${chalk.greenBright(coreTools)}
  ${chalk.green.dim('Skills:')}       ${chalk.greenBright(skills)}
  ${chalk.green.dim('CWD:')}          ${chalk.greenBright(process.cwd())}
`;
        return {
          continueToAgent: false,
          message: status
        };
      }
    });

    // /model - Show current model and available models
    this.register({
      name: 'model',
      aliases: ['m'],
      description: 'Show current LLM model and how to switch',
      usage: '/model',
      handler: async () => {
        let modelInfo = `
${chalk.green.bold('Model Configuration')}
${chalk.green('─'.repeat(40))}
  ${chalk.green.dim('Current Model:')}  ${chalk.greenBright(config.llm.defaultModel)}
  ${chalk.green.dim('Embedding:')}      ${chalk.greenBright(config.llm.embeddingModel)}
  ${chalk.green.dim('Context Size:')}   ${chalk.greenBright(config.llm.contextWindowSize.toLocaleString())} tokens

${chalk.green.dim('To switch models, set the DEFAULT_MODEL environment variable:')}
  ${chalk.cyan('DEFAULT_MODEL=llama3:70b neo')}

${chalk.green.dim('Or add to your .env file:')}
  ${chalk.cyan('DEFAULT_MODEL=qwen3-coder:30b')}
`;
        return {
          continueToAgent: false,
          message: modelInfo
        };
      }
    });

    // /review - Code review mode
    this.register({
      name: 'review',
      aliases: ['r'],
      description: 'Review code changes or specific files',
      usage: '/review [file_or_path]',
      handler: async (args, context) => {
        const target = args || '.';
        const reviewPrompt = `Please perform a thorough code review of ${target === '.' ? 'all recent changes in the project' : target}.

Focus on:
1. **Bugs & Logic Errors**: Identify potential bugs, edge cases, and logic issues
2. **Security**: Check for security vulnerabilities (injection, XSS, auth issues, etc.)
3. **Performance**: Note any performance concerns or inefficiencies
4. **Code Quality**: Comment on readability, maintainability, and best practices
5. **Suggestions**: Provide specific, actionable improvement suggestions

Be direct and specific. Reference line numbers when possible.`;

        return {
          continueToAgent: true,
          modifiedPrompt: reviewPrompt
        };
      }
    });

    // /plan - Planning mode
    this.register({
      name: 'plan',
      aliases: ['p'],
      description: 'Create a detailed implementation plan before coding',
      usage: '/plan <task_description>',
      handler: async (args) => {
        if (!args) {
          return {
            continueToAgent: false,
            message: chalk.yellow('Usage: /plan <task description>')
          };
        }

        const planPrompt = `Create a detailed implementation plan for the following task. Do NOT write any code yet - only create the plan.

TASK: ${args}

Your plan should include:
1. **Understanding**: Restate the task to confirm understanding
2. **Analysis**: What existing code/files need to be examined?
3. **Approach**: Step-by-step implementation approach
4. **Files**: List of files that will be created/modified
5. **Dependencies**: Any new dependencies needed?
6. **Testing**: How will we verify this works?
7. **Risks**: Potential issues or edge cases to consider

After creating the plan, wait for user approval before proceeding with implementation.`;

        return {
          continueToAgent: true,
          modifiedPrompt: planPrompt
        };
      }
    });

    // /init - Initialize project configuration
    this.register({
      name: 'init',
      aliases: [],
      description: 'Initialize NEO.md project configuration file',
      usage: '/init',
      handler: async () => {
        const neoMdPath = path.join(process.cwd(), 'NEO.md');

        if (fs.existsSync(neoMdPath)) {
          return {
            continueToAgent: false,
            message: chalk.yellow('NEO.md already exists. Delete it first to reinitialize.')
          };
        }

        const template = `# Project Configuration for NeoCLI

## Project Overview
<!-- Describe your project here. This helps the AI understand context. -->

## Tech Stack
<!-- List technologies, frameworks, languages used -->
-

## Code Style Guidelines
<!-- Any specific coding conventions to follow -->
-

## Important Files
<!-- Key files the AI should be aware of -->
-

## Custom Instructions
<!-- Any specific instructions for the AI when working on this project -->

## Do NOT
<!-- Things the AI should avoid doing -->
- Do not modify files in node_modules/
- Do not commit secrets or credentials
`;

        try {
          fs.writeFileSync(neoMdPath, template);
          return {
            continueToAgent: false,
            message: chalk.green(`✓ Created NEO.md. Edit it to configure project-specific instructions.`)
          };
        } catch (e) {
          return {
            continueToAgent: false,
            message: chalk.red(`Failed to create NEO.md: ${(e as Error).message}`)
          };
        }
      }
    });

    // /tools - List available tools
    this.register({
      name: 'tools',
      aliases: ['t'],
      description: 'List all available tools and skills',
      usage: '/tools',
      handler: async () => {
        const tools = await registry.getAvailableTools();

        const coreTools = tools.filter(t => t.source === 'CORE');
        const skills = tools.filter(t => t.source === 'SKILL');
        const mcpTools = tools.filter(t => t.source === 'MCP');

        let output = chalk.green.bold('\nAvailable Tools\n');
        output += chalk.green('─'.repeat(40)) + '\n';

        if (coreTools.length > 0) {
          output += chalk.green.bold('\n📦 Core Tools:\n');
          for (const tool of coreTools) {
            output += `  ${chalk.greenBright(tool.name.padEnd(25))} ${chalk.green.dim(tool.description?.substring(0, 50) || '')}\n`;
          }
        }

        if (skills.length > 0) {
          output += chalk.green.bold('\n🔧 Skills:\n');
          for (const skill of skills) {
            output += `  ${chalk.greenBright(skill.name.padEnd(25))} ${chalk.green.dim(skill.description?.substring(0, 50) || '')}\n`;
          }
        }

        if (mcpTools.length > 0) {
          output += chalk.green.bold('\n🔌 MCP Tools:\n');
          for (const tool of mcpTools) {
            output += `  ${chalk.greenBright(tool.name.padEnd(25))} ${chalk.green.dim(tool.description?.substring(0, 50) || '')}\n`;
          }
        }

        output += `\n${chalk.green.dim(`Total: ${tools.length} tools available`)}\n`;

        return {
          continueToAgent: false,
          message: output
        };
      }
    });

    // /map - Show/refresh project map
    this.register({
      name: 'map',
      aliases: [],
      description: 'Show or refresh the project structure map',
      usage: '/map [refresh]',
      handler: async (args, context) => {
        if (args === 'refresh') {
          await context.refreshRepoMap();
          return {
            continueToAgent: false,
            message: chalk.green('✓ Project map refreshed.')
          };
        }

        const map = context.getRepoMap();
        return {
          continueToAgent: false,
          message: chalk.green(map || 'No project map available. Run /map refresh')
        };
      }
    });

    // /history - Show conversation history
    this.register({
      name: 'history',
      aliases: ['hist'],
      description: 'Show recent conversation history',
      usage: '/history [count]',
      handler: async (args, context) => {
        const count = parseInt(args) || 10;
        const history = context.getHistory();
        const recent = history.slice(-count * 2);

        if (recent.length === 0) {
          return {
            continueToAgent: false,
            message: chalk.yellow('No conversation history.')
          };
        }

        let output = chalk.green.bold('\nRecent History\n');
        output += chalk.green('─'.repeat(40)) + '\n';

        for (const entry of recent) {
          if (entry.startsWith('[User]:')) {
            output += chalk.cyan(entry) + '\n';
          } else {
            output += chalk.green(entry) + '\n';
          }
        }

        return {
          continueToAgent: false,
          message: output
        };
      }
    });

    // /bug - Report a bug with context
    this.register({
      name: 'bug',
      aliases: ['debug', 'fix'],
      description: 'Analyze and fix a bug',
      usage: '/bug <description>',
      handler: async (args) => {
        if (!args) {
          return {
            continueToAgent: false,
            message: chalk.yellow('Usage: /bug <description of the bug>')
          };
        }

        const bugPrompt = `I need help debugging an issue:

BUG DESCRIPTION: ${args}

Please:
1. First, search the codebase to understand the relevant code
2. Identify the root cause of the bug
3. Explain what's going wrong and why
4. Propose a fix with the specific code changes needed
5. Consider any edge cases the fix should handle`;

        return {
          continueToAgent: true,
          modifiedPrompt: bugPrompt
        };
      }
    });

    // /test - Run tests
    this.register({
      name: 'test',
      aliases: [],
      description: 'Run project tests',
      usage: '/test [path]',
      handler: async (args) => {
        const testPrompt = args
          ? `Run the tests at ${args} and report the results. If any tests fail, analyze the failures and suggest fixes.`
          : `Find and run the project's test suite. Report the results. If any tests fail, analyze the failures and suggest fixes.`;

        return {
          continueToAgent: true,
          modifiedPrompt: testPrompt
        };
      }
    });

    // /commit - Smart git commit
    this.register({
      name: 'commit',
      aliases: ['save'],
      description: 'Create a smart git commit with auto-generated message',
      usage: '/commit',
      handler: async () => {
        const commitPrompt = `Please help me commit the current changes:
1. First run git status to see what's changed
2. Run git diff to understand the changes
3. Generate a clear, conventional commit message that describes what was changed and why
4. Stage appropriate files (be selective - don't stage generated files, logs, etc.)
5. Create the commit with the generated message

Use conventional commit format: type(scope): description`;

        return {
          continueToAgent: true,
          modifiedPrompt: commitPrompt
        };
      }
    });

    // Load custom commands
    this.loadCustomCommands();
  }

  /**
   * Loads custom commands from .neo/commands directory.
   */
  private loadCustomCommands(): void {
    try {
      if (!fs.existsSync(this.customCommandsDir)) {
        return;
      }

      const files = fs.readdirSync(this.customCommandsDir)
        .filter(f => f.endsWith('.md'));

      for (const file of files) {
        const name = path.basename(file, '.md');
        const content = fs.readFileSync(path.join(this.customCommandsDir, file), 'utf-8');

        this.register({
          name,
          aliases: [],
          description: `Custom command from ${file}`,
          usage: `/${name} [args]`,
          handler: async (args) => {
            // Replace {{args}} placeholder with actual args
            const prompt = content.replace(/\{\{args\}\}/g, args || '');
            return {
              continueToAgent: true,
              modifiedPrompt: prompt
            };
          }
        });

        logger.debug(`Loaded custom command: /${name}`);
      }
    } catch (e) {
      logger.warn('Failed to load custom commands', e);
    }
  }

  /**
   * Registers a new command.
   */
  register(command: SlashCommand): void {
    this.commands.set(command.name, command);
    for (const alias of command.aliases) {
      this.commands.set(alias, command);
    }
  }

  /**
   * Finds a command by alias.
   */
  private findByAlias(alias: string): SlashCommand | undefined {
    for (const cmd of this.commands.values()) {
      if (cmd.aliases.includes(alias)) {
        return cmd;
      }
    }
    return undefined;
  }

  /**
   * Checks if input is a slash command.
   */
  isCommand(input: string): boolean {
    return input.startsWith('/');
  }

  /**
   * Parses and executes a slash command.
   */
  async execute(input: string, context: CommandContext): Promise<CommandResult> {
    if (!this.isCommand(input)) {
      return { continueToAgent: true };
    }

    const parts = input.slice(1).split(/\s+/);
    const commandName = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');

    const command = this.commands.get(commandName);
    if (!command) {
      return {
        continueToAgent: false,
        message: chalk.yellow(`Unknown command: /${commandName}. Type /help for available commands.`)
      };
    }

    try {
      return await command.handler(args, context);
    } catch (e) {
      logger.error(`Command error: /${commandName}`, e);
      return {
        continueToAgent: false,
        message: chalk.red(`Command failed: ${(e as Error).message}`)
      };
    }
  }

  /**
   * Formats help for a single command.
   */
  private formatCommandHelp(cmd: SlashCommand): string {
    let help = chalk.green.bold(`\n/${cmd.name}`);
    if (cmd.aliases.length > 0) {
      help += chalk.green.dim(` (aliases: ${cmd.aliases.map(a => '/' + a).join(', ')})`);
    }
    help += '\n';
    help += chalk.green(cmd.description) + '\n';
    help += chalk.green.dim(`Usage: ${cmd.usage}`) + '\n';
    return help;
  }

  /**
   * Formats help for all commands.
   */
  private formatAllHelp(): string {
    const uniqueCommands = new Map<string, SlashCommand>();
    for (const [name, cmd] of this.commands) {
      if (name === cmd.name) {
        uniqueCommands.set(name, cmd);
      }
    }

    let help = chalk.green.bold('\nAvailable Commands\n');
    help += chalk.green('─'.repeat(40)) + '\n';

    const sorted = Array.from(uniqueCommands.values())
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const cmd of sorted) {
      const aliases = cmd.aliases.length > 0
        ? chalk.green.dim(` (${cmd.aliases.map(a => '/' + a).join(', ')})`)
        : '';
      help += `  ${chalk.greenBright('/' + cmd.name.padEnd(12))}${aliases}\n`;
      help += `    ${chalk.green.dim(cmd.description)}\n`;
    }

    help += chalk.green('\n─'.repeat(40));
    help += chalk.green.dim('\nType /help <command> for detailed usage.\n');

    return help;
  }
}

/** Singleton instance */
export const commands = new CommandRegistry();
