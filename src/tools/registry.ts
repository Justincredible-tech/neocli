// src/tools/registry.ts
/**
 * Tool Registry Module
 * Manages dynamic loading and execution of core tools and skills.
 */
import { Tool, ToolArgs } from '../types/index.js';
import { AgentUI } from '../utils/ui.js';
import { logger } from '../utils/logger.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { SkillsManager } from '../core/skills.js';

// Helper to get directory name in ESM
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Files to exclude from tool loading */
const EXCLUDED_FILES = new Set(['registry.ts', 'registry.js', 'loader.ts', 'loader.js']);

/**
 * ToolRegistry - Central registry for all executable tools.
 * Handles discovery, registration, and execution of tools.
 */
class ToolRegistry {
  private tools: Map<string, Tool> = new Map();
  private readonly skillsManager = new SkillsManager();
  private initialized = false;

  /**
   * Initializes the registry by loading all tools.
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    try {
      // 1. Load Core Tools from this directory
      await this.loadCoreTools();

      // 2. Load Skills from .neo/skills
      this.loadSkills();

      this.initialized = true;
      logger.info("Tool registry initialized", { toolCount: this.tools.size });
    } catch (e) {
      logger.error("Failed to initialize tool registry", e);
      throw e;
    }
  }

  /**
   * Loads core tools from the tools directory.
   */
  private async loadCoreTools(): Promise<void> {
    const toolFiles = fs.readdirSync(__dirname)
      .filter(f => (f.endsWith('.ts') || f.endsWith('.js')) && !EXCLUDED_FILES.has(f));

    for (const file of toolFiles) {
      try {
        const module = await import(`./${file}`);
        const tool = module.default || Object.values(module)[0];

        if (this.isValidTool(tool)) {
          this.register(tool);
          logger.debug(`Loaded core tool: ${tool.name}`);
        }
      } catch (e) {
        logger.warn(`Failed to load tool from ${file}`, e);
      }
    }
  }

  /**
   * Loads skills from the skills manager.
   */
  private loadSkills(): void {
    try {
      const skills = this.skillsManager.getSkillsAsTools();
      for (const skill of skills) {
        this.register(skill);
        logger.debug(`Loaded skill: ${skill.name}`);
      }
    } catch (e) {
      logger.warn("Failed to load skills", e);
    }
  }

  /**
   * Registers a tool in the registry.
   * @param tool - The tool to register
   */
  register(tool: Tool): void {
    if (!tool.name) {
      logger.warn("Attempted to register tool without name");
      return;
    }
    this.tools.set(tool.name, tool);
  }

  /**
   * Gets all available tools.
   * @returns Array of registered tools
   */
  async getAvailableTools(): Promise<Tool[]> {
    await this.init();
    return Array.from(this.tools.values());
  }

  /**
   * Gets a specific tool by name.
   * @param name - The tool name
   * @returns The tool or undefined
   */
  async getTool(name: string): Promise<Tool | undefined> {
    await this.init();
    return this.tools.get(name);
  }

  /**
   * Executes a tool by name.
   * @param name - The tool name
   * @param args - The tool arguments
   * @param ui - Optional UI instance for interaction
   * @returns The tool execution result
   */
  async execute(name: string, args: ToolArgs, ui?: AgentUI): Promise<string> {
    await this.init();

    const tool = this.tools.get(name);
    if (!tool) {
      const available = Array.from(this.tools.keys()).join(', ');
      throw new Error(`Tool "${name}" not found. Available: ${available}`);
    }

    const startTime = Date.now();

    try {
      const result = await tool.execute(args, ui);
      const duration = Date.now() - startTime;

      logger.info("Tool executed", { tool: name, durationMs: duration });
      return result;
    } catch (error) {
      const err = error as Error;
      logger.error(`Tool execution failed: ${name}`, err);
      throw new Error(`Tool Execution Failed (${name}): ${err.message}`);
    }
  }

  /**
   * Checks if an object is a valid tool.
   * @param obj - The object to check
   * @returns True if object is a valid tool
   */
  private isValidTool(obj: unknown): obj is Tool {
    if (!obj || typeof obj !== 'object') return false;
    const tool = obj as Record<string, unknown>;
    return (
      typeof tool.name === 'string' &&
      tool.name.length > 0 &&
      typeof tool.execute === 'function'
    );
  }

  /**
   * Gets the count of registered tools.
   */
  get count(): number {
    return this.tools.size;
  }

  /**
   * Reloads all tools (useful for dynamic skill updates).
   */
  async reload(): Promise<void> {
    this.tools.clear();
    this.initialized = false;
    await this.init();
  }
}

/** Singleton instance of the tool registry */
export const registry = new ToolRegistry();