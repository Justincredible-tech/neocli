// src/core/skills.ts
/**
 * Skills Manager Module
 * Handles loading, saving, and executing custom skills.
 * Includes basic sandboxing for skill execution.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import { Tool, SkillMeta, ToolArgs } from '../types/index.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

/** Timeout for skill execution - use config value */
const getSkillTimeout = () => config.skills.executionTimeoutMs;

/** Allowed globals for sandboxed skill execution */
const SAFE_GLOBALS = {
  console: {
    log: (...args: unknown[]) => logger.info('Skill console.log', { args }),
    warn: (...args: unknown[]) => logger.warn('Skill console.warn', { args }),
    error: (...args: unknown[]) => logger.error('Skill console.error', { args }),
  },
  JSON,
  Math,
  Date,
  Array,
  Object,
  String,
  Number,
  Boolean,
  RegExp,
  Error,
  TypeError,
  RangeError,
  Map,
  Set,
  Promise,
  Buffer,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  // Allow fetch for API calls
  fetch: globalThis.fetch,
  // Allow URL parsing
  URL,
  URLSearchParams,
};

/** Regex pattern for extracting skill metadata */
const SKILL_META_PATTERN = /\/\* NEO_SKILL_META([\s\S]*?)NEO_SKILL_META \*\//;

/**
 * SkillsManager - Manages custom skills stored in .neo/skills.
 */
export class SkillsManager {
  private readonly skillsDir: string;

  constructor() {
    this.skillsDir = config.paths.skillsDir;
    this.ensureDirectoryExists();
  }

  /**
   * Ensures the skills directory exists.
   */
  private ensureDirectoryExists(): void {
    try {
      if (!fs.existsSync(this.skillsDir)) {
        fs.mkdirSync(this.skillsDir, { recursive: true });
      }
    } catch (e) {
      logger.error("Failed to create skills directory", e);
    }
  }

  /**
   * Gets all skills as Tool objects.
   * @returns Array of tools representing skills
   */
  getSkillsAsTools(): Tool[] {
    const tools: Tool[] = [];

    if (!fs.existsSync(this.skillsDir)) {
      return tools;
    }

    const files = fs.readdirSync(this.skillsDir)
      .filter(f => f.endsWith('.ts') || f.endsWith('.js'));

    for (const file of files) {
      try {
        const filePath = path.join(this.skillsDir, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        const metaMatch = content.match(SKILL_META_PATTERN);

        if (metaMatch) {
          const meta = JSON.parse(metaMatch[1]) as SkillMeta;

          if (!meta.name || !meta.description) {
            logger.warn(`Skill ${file} has incomplete metadata`);
            continue;
          }

          tools.push({
            name: meta.name,
            description: `[SKILL] ${meta.description}`,
            source: 'SKILL',
            requiresApproval: false,
            execute: async (args: ToolArgs) => this.runSkill(file, args)
          });
        }
      } catch (e) {
        logger.warn(`Failed to load skill from ${file}`, e);
      }
    }

    return tools;
  }

  /**
   * Saves a new skill to the skills directory.
   * @param name - The skill name
   * @param description - The skill description
   * @param code - The skill code
   * @param argsSchema - Optional JSON schema for arguments
   * @returns Success message
   */
  async saveSkill(
    name: string,
    description: string,
    code: string,
    argsSchema?: Record<string, unknown>
  ): Promise<string> {
    // Validate inputs
    if (!name || typeof name !== 'string') {
      throw new Error("Skill name is required");
    }

    if (!description || typeof description !== 'string') {
      throw new Error("Skill description is required");
    }

    if (!code || typeof code !== 'string') {
      throw new Error("Skill code is required");
    }

    // Sanitize name
    const cleanName = name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const filename = `${cleanName}.ts`;

    // Build metadata block
    const meta: SkillMeta = {
      name: cleanName,
      description,
      argsSchema: { type: "object", ...argsSchema }
    };

    const metaBlock = `/* NEO_SKILL_META
${JSON.stringify(meta, null, 2)}
NEO_SKILL_META */

`;

    const fullContent = metaBlock + code;
    const filePath = path.join(this.skillsDir, filename);

    try {
      fs.writeFileSync(filePath, fullContent, 'utf-8');
      logger.info("Skill saved", { name: cleanName, path: filePath });
      return `Skill saved as ${cleanName}`;
    } catch (e) {
      logger.error("Failed to save skill", e);
      throw new Error(`Failed to save skill: ${(e as Error).message}`);
    }
  }

  /**
   * Runs a skill by filename with sandboxing and timeout protection.
   * @param filename - The skill filename
   * @param args - The arguments to pass to the skill
   * @returns The skill execution result
   */
  private async runSkill(filename: string, args: ToolArgs): Promise<string> {
    const scriptPath = path.join(this.skillsDir, filename);

    try {
      // Validate file exists
      if (!fs.existsSync(scriptPath)) {
        return `Error: Skill file not found: ${filename}`;
      }

      // Read and compile the skill code
      const code = fs.readFileSync(scriptPath, 'utf-8');

      // Remove the metadata block for execution
      const executableCode = code.replace(SKILL_META_PATTERN, '');

      // Create a sandboxed context with limited globals
      const sandbox = {
        ...SAFE_GLOBALS,
        args,
        exports: {} as Record<string, unknown>,
        module: { exports: {} as Record<string, unknown> },
        __filename: scriptPath,
        __dirname: this.skillsDir,
        // Provide fs with read-only operations for skill use
        fs: {
          readFileSync: fs.readFileSync.bind(fs),
          existsSync: fs.existsSync.bind(fs),
          statSync: fs.statSync.bind(fs),
          readdirSync: fs.readdirSync.bind(fs),
        },
        // Provide path utilities
        path: {
          join: path.join.bind(path),
          resolve: path.resolve.bind(path),
          dirname: path.dirname.bind(path),
          basename: path.basename.bind(path),
          extname: path.extname.bind(path),
        },
        require: (moduleName: string) => {
          // Only allow safe built-in modules
          const allowedModules: Record<string, unknown> = {
            path: { join: path.join, resolve: path.resolve, dirname: path.dirname, basename: path.basename },
          };
          if (allowedModules[moduleName]) {
            return allowedModules[moduleName];
          }
          throw new Error(`Module '${moduleName}' is not allowed in skills. Use the provided globals.`);
        },
      };

      // Create the VM context
      const context = vm.createContext(sandbox);

      // Wrap the code to capture the run function
      const wrappedCode = `
        (async function() {
          ${executableCode}

          // Handle both ESM-style export and CommonJS-style
          const runFn = typeof run === 'function' ? run :
                       (exports.run || module.exports.run || module.exports.default);

          if (typeof runFn !== 'function') {
            throw new Error("Skill must export a 'run' function");
          }

          return await runFn(args);
        })()
      `;

      // Execute with timeout
      const timeoutMs = getSkillTimeout();
      const script = new vm.Script(wrappedCode, {
        filename: scriptPath,
      });

      const resultPromise = script.runInContext(context, {
        timeout: timeoutMs,
      }) as Promise<unknown>;

      // Add timeout to the promise execution as well
      const result = await Promise.race([
        resultPromise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Skill execution timed out after ${timeoutMs}ms`)), timeoutMs)
        ),
      ]);

      // Convert result to string
      if (typeof result === 'string') {
        return result;
      }
      return JSON.stringify(result, null, 2);

    } catch (e: unknown) {
      const error = e as Error;
      logger.error(`Skill execution failed: ${filename}`, error);

      if (error.message.includes('timed out')) {
        const timeoutSec = getSkillTimeout() / 1000;
        return `Skill Execution Timeout: The skill took too long to execute (>${timeoutSec}s limit).`;
      }

      return `Skill Execution Error: ${error.message}`;
    }
  }

  /**
   * Lists all available skills.
   * @returns Array of skill names
   */
  listSkills(): string[] {
    if (!fs.existsSync(this.skillsDir)) {
      return [];
    }

    return fs.readdirSync(this.skillsDir)
      .filter(f => f.endsWith('.ts') || f.endsWith('.js'))
      .map(f => f.replace(/\.(ts|js)$/, ''));
  }

  /**
   * Deletes a skill by name.
   * @param name - The skill name
   * @returns True if skill was deleted
   */
  deleteSkill(name: string): boolean {
    const cleanName = name.toLowerCase().replace(/[^a-z0-9_]/g, '_');

    for (const ext of ['.ts', '.js']) {
      const filePath = path.join(this.skillsDir, cleanName + ext);
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
          logger.info("Skill deleted", { name: cleanName });
          return true;
        } catch (e) {
          logger.error("Failed to delete skill", e);
          return false;
        }
      }
    }

    return false;
  }
}