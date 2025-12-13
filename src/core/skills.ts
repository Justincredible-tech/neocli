// src/core/skills.ts
/**
 * Skills Manager Module
 * Handles loading, saving, and executing custom skills.
 */
import * as fs from 'fs';
import * as path from 'path';
import { Tool, SkillMeta, ToolArgs } from '../types/index.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

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
   * Runs a skill by filename.
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

      // Dynamic import with cache busting for development
      const modulePath = `file://${scriptPath}?t=${Date.now()}`;
      const module = await import(modulePath);

      // Try to find the run function
      let runFn: ((args: ToolArgs) => Promise<unknown>) | undefined;

      if (typeof module.run === 'function') {
        runFn = module.run;
      } else if (typeof module.default === 'function') {
        runFn = module.default;
      }

      if (!runFn) {
        return "Error: Skill must export a 'run' function or default export.";
      }

      // Execute the skill
      const result = await runFn(args);

      // Convert result to string
      if (typeof result === 'string') {
        return result;
      }
      return JSON.stringify(result, null, 2);

    } catch (e) {
      const error = e as Error;
      logger.error(`Skill execution failed: ${filename}`, error);
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