// src/core/mcp.ts
/**
 * MCP (Model Context Protocol) Client
 * Handles communication with external MCP servers for tool integration.
 */
import { Tool } from '../types/index.js';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';

/** MCP Server configuration */
interface MCPServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled?: boolean;
}

/** MCP configuration file structure */
interface MCPConfig {
  servers: MCPServerConfig[];
}

/**
 * MCPClient - Manages connections to MCP servers.
 * Currently a placeholder for future MCP protocol implementation.
 */
export class MCPClient {
  private readonly configPath: string;
  private config: MCPConfig = { servers: [] };

  constructor() {
    this.configPath = config.paths.mcpConfigFile;
    this.ensureConfigExists();
    this.loadConfig();
  }

  /**
   * Ensures the MCP configuration file exists.
   */
  private ensureConfigExists(): void {
    try {
      const configDir = path.dirname(this.configPath);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }

      if (!fs.existsSync(this.configPath)) {
        const defaultConfig: MCPConfig = {
          servers: []
        };
        fs.writeFileSync(this.configPath, JSON.stringify(defaultConfig, null, 2));
        logger.info("Created default MCP config", { path: this.configPath });
      }
    } catch (e) {
      logger.error("Failed to create MCP config", e);
    }
  }

  /**
   * Loads the MCP configuration from disk.
   */
  private loadConfig(): void {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf-8');
        this.config = JSON.parse(data);
        logger.info("MCP config loaded", { serverCount: this.config.servers.length });
      }
    } catch (e) {
      logger.warn("Failed to load MCP config", e);
      this.config = { servers: [] };
    }
  }

  /**
   * Gets tools from all connected MCP servers.
   * @returns Array of tools from MCP servers
   */
  async getTools(): Promise<Tool[]> {
    // TODO: Implement actual MCP protocol communication
    // This is a placeholder that returns an empty array
    // Future implementation will:
    // 1. Connect to each enabled server via stdio/SSE
    // 2. Call tools/list to get available tools
    // 3. Wrap each tool in our Tool interface
    // 4. Handle tool execution via tools/call

    const tools: Tool[] = [];

    for (const server of this.config.servers) {
      if (server.enabled === false) continue;

      // Placeholder for future MCP tool loading
      logger.debug(`MCP server configured but not yet implemented: ${server.name}`);
    }

    return tools;
  }

  /**
   * Adds a new MCP server to the configuration.
   * @param serverConfig - The server configuration
   */
  addServer(serverConfig: MCPServerConfig): void {
    // Check for duplicate names
    const existing = this.config.servers.findIndex(s => s.name === serverConfig.name);
    if (existing >= 0) {
      this.config.servers[existing] = serverConfig;
    } else {
      this.config.servers.push(serverConfig);
    }

    this.saveConfig();
    logger.info("MCP server added", { name: serverConfig.name });
  }

  /**
   * Removes an MCP server from the configuration.
   * @param name - The server name to remove
   */
  removeServer(name: string): boolean {
    const index = this.config.servers.findIndex(s => s.name === name);
    if (index >= 0) {
      this.config.servers.splice(index, 1);
      this.saveConfig();
      logger.info("MCP server removed", { name });
      return true;
    }
    return false;
  }

  /**
   * Lists all configured MCP servers.
   * @returns Array of server configurations
   */
  listServers(): MCPServerConfig[] {
    return [...this.config.servers];
  }

  /**
   * Saves the configuration to disk.
   */
  private saveConfig(): void {
    try {
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
    } catch (e) {
      logger.error("Failed to save MCP config", e);
    }
  }
}

/** Singleton instance of the MCP client */
export const mcp = new MCPClient();
