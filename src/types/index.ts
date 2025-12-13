// src/types/index.ts
/**
 * Core Type Definitions for NeoCLI
 */
import { AgentUI } from '../utils/ui.js';

/** Tool source types */
export type ToolSource = 'CORE' | 'SKILL' | 'MCP';

/** Tool argument types - can be various primitives or objects */
export type ToolArgs = Record<string, unknown>;

/**
 * Tool interface - defines the structure of executable tools.
 */
export interface Tool {
  /** Unique name identifier for the tool */
  name: string;
  /** Human-readable description of what the tool does */
  description: string;
  /** Source of the tool (core, skill, or MCP) */
  source: ToolSource;
  /** Whether this tool requires user approval before execution */
  requiresApproval?: boolean;
  /** The execution function */
  execute: (args: ToolArgs, ui?: AgentUI) => Promise<string>;
}

/**
 * Agent context - provides environment information to tools.
 */
export interface AgentContext {
  /** Current working directory */
  cwd: string;
  /** Environment variables */
  env: NodeJS.ProcessEnv;
}

/**
 * Skill metadata structure embedded in skill files.
 */
export interface SkillMeta {
  /** Skill name (used as tool name) */
  name: string;
  /** Human-readable description */
  description: string;
  /** JSON schema for arguments */
  argsSchema: {
    type: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * Result of a tool execution.
 */
export interface ToolResult {
  /** Whether execution was successful */
  success: boolean;
  /** Result output or error message */
  output: string;
  /** Execution duration in milliseconds */
  durationMs?: number;
}

/**
 * Log levels for the logger.
 */
export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'ACTION';

/**
 * Memory fragment type.
 */
export type MemoryType = 'FACT' | 'EPISODE' | 'PREFERENCE';