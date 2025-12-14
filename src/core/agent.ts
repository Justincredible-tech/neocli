// src/core/agent.ts
/**
 * Core Agent Module
 * Implements the cognitive architecture for the autonomous developer agent.
 * Handles the perception-reasoning-action loop with safety mechanisms.
 */
import { router } from './llm.js';
import { registry } from '../tools/registry.js';
import { AgentUI } from '../utils/ui.js';
import { SecurityGuard } from '../utils/security.js';
import { logger } from '../utils/logger.js';
import { memory } from './memory_store.js';
import { config } from '../config.js';
import { formatCompleteResponse } from '../utils/formatter.js';
import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

// Track if we've already set up keypress events to avoid duplicates
let keypressEventsInitialized = false;

// Limit how much repo map we stuff into the prompt to keep tokens bounded
const MAX_REPO_MAP_CHARS = 4000;

/** Parsed JSON response from LLM */
interface ParsedResponse {
  tool: string;
  args: Record<string, unknown>;
}

/** Result of the agent run */
interface AgentRunResult {
  success: boolean;
  output: string;
  steps: number;
}

// --- COGNITIVE ARCHITECTURE V2.5 ---
const SYSTEM_PROMPT = "<ROLE> Neo autonomous developer. Keep responses concise. Use tools via JSON with one tool per turn. Focus on skills first. </ROLE>";

/**
 * Agent class - The core autonomous developer agent.
 * Implements a multi-phase cognitive loop with safety mechanisms.
 */
export class Agent {
  private readonly ui = new AgentUI();
  private readonly maxSteps: number;
  private readonly maxOutputLength: number;
  private readonly actionHistorySize: number;
  private readonly loopThreshold: number;
  private readonly maxChatHistoryEntries: number;

  private longTermMemory: string[] = [];
  private abortController: AbortController | null = null;
  private actionHistory: string[] = [];
  private repoMap: string = "";
  private readonly memoryFile: string;
  private projectConfig: string = "";
  private consecutiveParseErrors: number = 0;
  private readonly maxConsecutiveParseErrors: number = 5;

  constructor() {
    // Load configuration
    this.maxSteps = config.agent.maxSteps;
    this.maxOutputLength = config.agent.maxOutputLength;
    this.actionHistorySize = config.agent.actionHistorySize;
    this.loopThreshold = config.agent.loopThreshold;
    this.maxChatHistoryEntries = config.agent.maxChatHistoryEntries;
    this.memoryFile = config.paths.chatHistoryFile;

    logger.init();
    this.loadChatHistory();
  }

  // --- PUBLIC API FOR COMMAND INTEGRATION ---

  /**
   * Sets project-specific configuration (from NEO.md).
   * @param config - The project configuration content
   */
  setProjectConfig(config: string): void {
    this.projectConfig = config;
  }

  /**
   * Clears the conversation history.
   */
  clearHistory(): void {
    this.longTermMemory = [];
    this.actionHistory = [];
    this.persistChatHistory();
    logger.info("History cleared");
  }

  /**
   * Gets the current conversation history.
   * @returns Array of history entries
   */
  getHistory(): string[] {
    return [...this.longTermMemory];
  }

  /**
   * Sets the conversation history (used by /compact).
   * @param history - The new history array
   */
  setHistory(history: string[]): void {
    this.longTermMemory = history;
    this.persistChatHistory();
  }

  /**
   * Gets the current repository map.
   * @returns The repo map string
   */
  getRepoMap(): string {
    return this.repoMap;
  }

  /**
   * Public method to refresh the repository map.
   */
  async refreshMap(): Promise<void> {
    this.repoMap = await this.generateInternalMap();
    logger.info("Repo map refreshed", { size: this.repoMap.length });
  }

  /**
   * Persists chat history to disk.
   */
  private persistChatHistory(): void {
    try {
      const dir = path.dirname(this.memoryFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.memoryFile, JSON.stringify(this.longTermMemory, null, 2));
    } catch (e) {
      logger.error("Failed to persist chat history", e);
    }
  }

  /**
   * Retrieves the user profile from stored facts.
   * @returns Formatted user profile string
   */
  private getUserProfile(): string {
    const facts = memory.getFacts();
    if (facts.length === 0) {
      return "User: Unknown (No profile data saved yet)";
    }
    return `User Profile:\n${facts.join('\n')}`;
  }

  /**
   * Initializes the agent by generating the repository map.
   * Should be called before the first run.
   */
  async init(): Promise<void> {
    this.ui.updateStatus('THINKING');
    try {
      this.repoMap = await this.generateInternalMap();
      logger.info("Cognitive Context Loaded", { mapSize: this.repoMap.length });
    } catch (e) {
      logger.error("Failed to initialize cognitive context", e);
    }
    this.ui.stop();
  }

  /**
   * Runs the agent with a given goal/objective.
   * Implements the perception-reasoning-action loop.
   * @param goal - The user's objective/query
   * @returns Result of the agent run
   */
  async run(goal: string): Promise<AgentRunResult> {
    if (!this.repoMap) await this.init();

    logger.info("New Run", { goal });
    this.ui.start();
    this.actionHistory = [];
    this.consecutiveParseErrors = 0;  // Reset parse error counter for new run
    this.abortController = new AbortController();

    this.setupInterruptHandler();

    const tools = await registry.getAvailableTools();
    const toolList = tools.map(t => `"${t.name}"`).join(', ');

    const repoMapSnippet = this.repoMap.length > MAX_REPO_MAP_CHARS
      ? this.repoMap.slice(0, MAX_REPO_MAP_CHARS) + '\n... [truncated]'
      : this.repoMap;

    let conversation = `
${SYSTEM_PROMPT}
${this.projectConfig}
<CONTEXT_LAYER_0: PERSISTENT_KNOWLEDGE>
${repoMapSnippet}

${this.getUserProfile()}
</CONTEXT_LAYER_0>

<CONTEXT_LAYER_1: WORKING_MEMORY>
${this.longTermMemory.slice(-20).join('\n')}
</CONTEXT_LAYER_1>

<USER_OBJECTIVE>
${goal}
</USER_OBJECTIVE>
`;
    
    let steps = 0;

    try {
      while (steps < this.maxSteps) {
        if (this.abortController?.signal.aborted) throw new Error("ABORTED");

        this.ui.updateStatus('THINKING');

        // 1. GENERATE
        const responseText = await router.generate(conversation, SYSTEM_PROMPT, this.abortController?.signal);
        
        // 2. PARSE
        const json = this.parseResponse(responseText);

        // --- SAFETY: Parse Error Recovery ---
        if (json.tool === 'system_error') {
          this.consecutiveParseErrors++;
          logger.warn(`Parse error ${this.consecutiveParseErrors}/${this.maxConsecutiveParseErrors}`, { message: json.args.message });

          // If too many consecutive parse errors, ask the user for help
          if (this.consecutiveParseErrors >= this.maxConsecutiveParseErrors) {
            this.ui.stop();
            const errorMsg = `I'm having trouble processing responses from the model (${this.consecutiveParseErrors} consecutive parse errors). The model may not be outputting valid JSON. Please try rephrasing your request or check if Ollama is running correctly.`;
            console.log(formatCompleteResponse(errorMsg));
            this.saveChatHistory(goal, errorMsg);
            return { success: false, output: errorMsg, steps };
          }

          this.ui.updateOutput(chalk.yellow(`[Parse Error ${this.consecutiveParseErrors}/${this.maxConsecutiveParseErrors}] Asking model to retry...`));
          conversation += `\nSYSTEM_ERROR: ${json.args.message}`;
          steps++;  // Count parse errors as steps to prevent infinite loops
          continue;
        }

        // Reset consecutive parse errors on successful parse
        this.consecutiveParseErrors = 0;

        // --- SAFETY: Loop Detection ---
        if (this.detectLoop(json.tool, json.args as Record<string, unknown>)) {
             const loopCount = this.countRecentLoops();
             if (loopCount <= this.loopThreshold) {
                 this.ui.updateOutput(chalk.green(`[System Alert] Loop detected (${loopCount}/${this.loopThreshold}). Retrying...`));
                 logger.warn(`Loop Detected (${loopCount}/${this.loopThreshold})`, { tool: json.tool, args: json.args }); // LOGGED
                 conversation += `\nSYSTEM_ALERT: Cognitive Stagnation Detected. You are repeating action "${json.tool}". Pivot your strategy immediately.`;
                 continue;
             } else {
                console.log(chalk.green("\n[!] Cognitive Collapse. Forcing intervention."));
                logger.error("Cognitive Collapse", { tool: json.tool, args: json.args }); // LOGGED
                json.tool = 'final_answer';
                json.args = { text: "I am experiencing a cognitive loop and cannot proceed safely. I will reset my state." };
             }
        }

        // 3. FINAL ANSWER
        if (json.tool === 'final_answer') {
          const argsObj = json.args as Record<string, unknown>;
          const hasContent = argsObj.text || argsObj.result;

          if (!hasContent) {
            logger.warn("Empty final_answer received", { goal, step: steps, args: json.args });
            this.ui.updateOutput('Model returned empty final answer; requesting retry...');
            // Re-prompt the model to supply an actual answer
            conversation += `\nSYSTEM_ERROR: Final answer missing content. Respond with a meaningful "text" field.`;
            continue;
          }

          this.ui.stop();
          // Ensure we never surface an empty JSON object as the "answer"
          const output = String(
            argsObj.text ||
            argsObj.result ||
            'No response content was provided by the model.'
          );
          // Format the output with word wrapping and markdown styling
          console.log(formatCompleteResponse(output));
          this.saveChatHistory(goal, output);
          return { success: true, output, steps };
        }

        // 4. VALIDATE
        const toolDef = tools.find(t => t.name === json.tool);
        if (!toolDef) {
          conversation += `\nSYSTEM ERROR: Tool "${json.tool}" does not exist. Available: ${toolList}.`;
          continue;
        }

        // 5. APPROVAL
        if (SecurityGuard.isHighRisk(json.tool, json.args)) {
          const approved = await this.ui.askApproval(json.tool, json.args);
          if (!approved) {
            conversation += `\nSYSTEM: User denied permission.`;
            continue;
          }
        }

        // 6. EXECUTE
        this.ui.updateTool(json.tool, json.args, toolDef.source);
        logger.action(json.tool, json.args);

        let result = '';
        try {
          if (json.tool === 'write_file' || json.tool === 'create_skill') {
             setTimeout(() => this.refreshMap(), 100); 
          }
          result = await registry.execute(json.tool, json.args || {}, this.ui);
          // Auto-reload tool registry after creating a skill so it is immediately usable
          if (json.tool === 'create_skill') {
            await registry.reload();
          }
        } catch (execError: any) {
          result = `Error: ${execError.message}`;
        }

        this.ui.updateOutput(result);

        const trimmed = result.length > this.maxOutputLength
            ? result.substring(0, this.maxOutputLength) + `... [Output Truncated. ${result.length - this.maxOutputLength} chars hidden. Use pagination.]`
            : result;

        conversation += `\n<TOOL_OUTPUT tool="${json.tool}">\n${trimmed}\n</TOOL_OUTPUT>\n`;
        steps++;
      }

      // If we exit the loop without a final answer, surface a clear limit message
      this.ui.stop();
      const limitMessage = `Reached maximum step limit (${this.maxSteps}) without completing the objective. Please refine the request or allow more steps.`;
      console.log(chalk.green(`\n[!] ${limitMessage}`));
      this.saveChatHistory(goal, limitMessage);
      return { success: false, output: limitMessage, steps };
    } catch (e: unknown) {
      this.ui.stop();
      const error = e as Error;

      if (error.message === "ABORTED") {
        console.log(chalk.green("\n[!] Operation cancelled by user."));
        this.saveChatHistory(goal, "[Cancelled]");
        return { success: false, output: 'Cancelled', steps };
      } else {
        logger.error("Critical agent error", error);
        console.error(chalk.green("\n[!] Critical Error:"), chalk.greenBright(error.message));
        return { success: false, output: error.message, steps };
      }
    } finally {
      this.cleanupInterruptHandler();
    }
  }

  // --- INTERNAL UTILITIES ---

  /**
   * Generates an internal map of the project structure.
   * Used for agent context and navigation.
   * @returns Formatted project structure string
   */
  private async generateInternalMap(): Promise<string> {
    const ignore = config.filesystem.ignoredDirectories;
    const maxDepth = config.filesystem.maxDirectoryDepth;

    function walk(dir: string, depth: number): string {
      if (depth > maxDepth) return "";
      let output = "";
      try {
        const files = fs.readdirSync(dir, { withFileTypes: true });
        files.sort((a, b) => {
          if (a.isDirectory() && !b.isDirectory()) return -1;
          if (!a.isDirectory() && b.isDirectory()) return 1;
          return a.name.localeCompare(b.name);
        });

        for (const f of files) {
          if (ignore.includes(f.name)) continue;
          const prefix = "  ".repeat(depth) + "|- ";
          if (f.isDirectory()) {
            output += `${prefix}📂 ${f.name}/\n` + walk(path.join(dir, f.name), depth + 1);
          } else {
            try {
              const stats = fs.statSync(path.join(dir, f.name));
              const sizeKB = Math.ceil(stats.size / 1024);
              output += `${prefix}${f.name} (${sizeKB}KB)\n`;
            } catch {
              output += `${prefix}${f.name}\n`;
            }
          }
        }
      } catch {
        return "";
      }
      return output;
    }

    return "Project Structure:\n" + walk(process.cwd(), 0);
  }

  /**
   * Loads chat history from persistent storage.
   */
  private loadChatHistory(): void {
    try {
      if (fs.existsSync(this.memoryFile)) {
        const data = fs.readFileSync(this.memoryFile, 'utf-8');
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed)) {
          this.longTermMemory = parsed;
        }
      }
    } catch (e) {
      logger.warn("Failed to load chat history", e);
      this.longTermMemory = [];
    }
  }

  /**
   * Saves chat history to persistent storage.
   * @param input - User input
   * @param output - Agent output
   */
  private saveChatHistory(input: string, output: string): void {
    this.longTermMemory.push(`[User]: ${input}`);
    this.longTermMemory.push(`[Neo]: ${output}`);

    // Trim to max entries
    if (this.longTermMemory.length > this.maxChatHistoryEntries) {
      this.longTermMemory = this.longTermMemory.slice(-this.maxChatHistoryEntries);
    }

    try {
      const dir = path.dirname(this.memoryFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.memoryFile, JSON.stringify(this.longTermMemory, null, 2));
    } catch (e) {
      logger.error("Failed to persist chat history", e);
    }
  }

  /**
   * Detects if the agent is stuck in a loop.
   * @param tool - The tool being called
   * @param args - The tool arguments
   * @returns True if a loop is detected
   */
  private detectLoop(tool: string, args: Record<string, unknown>): boolean {
    const sortedKeys = Object.keys(args || {}).sort();
    const stableArgs = JSON.stringify(args, sortedKeys);
    const signature = `${tool}:${stableArgs}`;

    this.actionHistory.push(signature);

    // Keep history bounded
    if (this.actionHistory.length > this.actionHistorySize) {
      this.actionHistory.shift();
    }

    // Check if this action matches the previous one
    const previousAction = this.actionHistory[this.actionHistory.length - 2];
    return previousAction === signature;
  }

  /**
   * Counts consecutive loop occurrences.
   * @returns Number of consecutive loops
   */
  private countRecentLoops(): number {
    if (this.actionHistory.length < 2) return 0;

    const current = this.actionHistory[this.actionHistory.length - 1];
    let count = 0;

    for (let i = this.actionHistory.length - 2; i >= 0; i--) {
      if (this.actionHistory[i] === current) {
        count++;
      } else {
        break;
      }
    }

    return count;
  }

  /**
   * Parses LLM response to extract JSON tool call.
   * Implements robust parsing with error recovery.
   * Handles JSON, XML tool format, and plain conversational responses.
   * @param text - Raw LLM response text
   * @returns Parsed response object
   */
  private parseResponse(text: string): ParsedResponse {
    try {
      // Remove markdown code blocks
      let cleanText = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '');

      // STEP 1: Try to find JSON with 'tool' field
      let jsonStr = this.extractBestJsonObject(cleanText);

      if (jsonStr) {
        // Patch common LLM typos - fix quoted numbers like "lines": "100"
        jsonStr = jsonStr.replace(/:\s*"(\d+)"/g, ': $1');

        try {
          const parsed = JSON.parse(jsonStr);

          // Handle alternative format: {"name": "tool_name", "arguments": {...}}
          // Some models (especially Qwen) use this format instead of {"tool": ..., "args": ...}
          if (parsed.name && typeof parsed.name === 'string' && !parsed.tool) {
            logger.info("Converted name/arguments format to tool/args", { name: parsed.name });
            // Handle arguments as string (OpenAI format) or object
            let args = {};
            if (typeof parsed.arguments === 'string') {
              try { args = JSON.parse(parsed.arguments); } catch { args = {}; }
            } else if (parsed.arguments && typeof parsed.arguments === 'object') {
              args = parsed.arguments;
            } else if (parsed.args && typeof parsed.args === 'object') {
              args = parsed.args;
            }
            return { tool: parsed.name.trim(), args };
          }

          // Handle OpenAI function calling format: {"tool": {"type": "function", "function": {"name": "X", "arguments": "..."}}}
          if (parsed.tool && typeof parsed.tool === 'object') {
            let toolName: string | null = null;
            let args: Record<string, unknown> = {};

            // Format: {"tool": {"type": "function", "function": {"name": "X", "arguments": "..."}}}
            if (parsed.tool.function && parsed.tool.function.name) {
              toolName = parsed.tool.function.name;
              if (typeof parsed.tool.function.arguments === 'string') {
                try { args = JSON.parse(parsed.tool.function.arguments); } catch { args = {}; }
              } else if (parsed.tool.function.arguments && typeof parsed.tool.function.arguments === 'object') {
                args = parsed.tool.function.arguments;
              }
            }
            // Format: {"tool": {"type": "X", "name": "X"}, "args": {...}}
            else if (parsed.tool.name && typeof parsed.tool.name === 'string') {
              toolName = parsed.tool.name;
              args = (parsed.args && typeof parsed.args === 'object') ? parsed.args : {};
            }

            if (toolName) {
              logger.info("Converted OpenAI function format to tool/args", { tool: toolName });
              return { tool: toolName.trim(), args };
            }
          }

          // Handle array format: [{"function": {"name": "X", "arguments": "..."}}]
          if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].function) {
            const func = parsed[0].function;
            if (func.name) {
              let args = {};
              if (typeof func.arguments === 'string') {
                try { args = JSON.parse(func.arguments); } catch { args = {}; }
              } else if (func.arguments && typeof func.arguments === 'object') {
                args = func.arguments;
              }
              logger.info("Converted array function format to tool/args", { tool: func.name });
              return { tool: func.name.trim(), args };
            }
          }

          // Validate that tool field exists and is a non-empty string
          if (!parsed.tool || typeof parsed.tool !== 'string' || parsed.tool.trim() === '') {
            logger.warn("JSON missing tool field", { parsed });
            return {
              tool: 'system_error',
              args: {
                message: "Your JSON is missing the 'tool' field. You MUST specify which tool to use. Example: {\"tool\": \"read_file\", \"args\": {\"path\": \"file.txt\"}}"
              }
            };
          }

          return {
            tool: parsed.tool.trim(),
            args: (parsed.args && typeof parsed.args === 'object') ? parsed.args : {}
          };
        } catch (parseError) {
          const error = parseError as Error;
          logger.warn("JSON parse error", { error: error.message, jsonStr: jsonStr.substring(0, 200) });
          return {
            tool: 'system_error',
            args: { message: `JSON Syntax Error: ${error.message}. Check for trailing commas, unescaped quotes, or malformed structure.` }
          };
        }
      }

      // STEP 2: Try to parse XML tool format (common with Qwen and other models)
      const xmlResult = this.parseXmlToolCall(text);
      if (xmlResult) {
        logger.info("Parsed XML tool call", { tool: xmlResult.tool });
        return xmlResult;
      }

      // STEP 3: Check if this looks like a conversational response (final answer)
      // If the model is clearly trying to communicate with the user, treat it as final_answer
      if (this.looksLikeConversationalResponse(text)) {
        logger.info("Detected conversational response, treating as final_answer");
        return {
          tool: 'final_answer',
          args: { text: this.cleanFinalAnswerText(text) }
        };
      }

      // STEP 4: No valid format found - ask model to retry
      logger.warn("No JSON found in LLM response", { responsePreview: text.substring(0, 200) });
      return {
        tool: 'system_error',
        args: {
          message: "No valid JSON command found. You MUST output JSON like: {\"tool\": \"final_answer\", \"args\": {\"text\": \"your response\"}} or {\"tool\": \"read_file\", \"args\": {\"path\": \"file.txt\"}}"
        }
      };
    } catch (e) {
      const error = e as Error;
      logger.error("Unexpected error in parseResponse", error);
      return {
        tool: 'system_error',
        args: { message: `Response parsing failed: ${error.message}. Please output valid JSON.` }
      };
    }
  }

  /**
   * Parses XML tool call format that some models output.
   * Handles formats like: <tool><tool_name>X</tool_name><tool_parameters><param>value</param></tool_parameters></tool>
   * @param text - Raw LLM response text
   * @returns Parsed response or null if no XML tool found
   */
  private parseXmlToolCall(text: string): ParsedResponse | null {
    // Handle single self-closing/simple tags like <create_skill name="..." code="..."/>
    const singleTagMatch = text.match(/<([a-zA-Z0-9_]+)\s+([^>]*?)\/?>/);
    if (singleTagMatch) {
      const tag = singleTagMatch[1];
      const attrsRaw = singleTagMatch[2];
      const attrs: Record<string, unknown> = {};
      const attrRegex = /(\w+)="([^"]*)"/g;
      let m;
      while ((m = attrRegex.exec(attrsRaw)) !== null) {
        const key = m[1];
        attrs[key] = m[2];
      }
      if (Object.keys(attrs).length > 0) {
        return { tool: tag, args: attrs };
      }
    }

    // Match <tool>...</tool> or <tool_call>...</tool_call> blocks
    const toolBlockMatch = text.match(/<(?:tool|tool_call)>([\s\S]*?)<\/(?:tool|tool_call)>/i);
    if (!toolBlockMatch) {
      // Also try simpler format: <tool_name>X</tool_name>
      const simpleMatch = text.match(/<tool_name>\s*(\w+)\s*<\/tool_name>/i);
      if (!simpleMatch) return null;

      const toolName = simpleMatch[1];
      const args = this.extractXmlParameters(text);
      return { tool: toolName, args };
    }

    const toolBlock = toolBlockMatch[1];

    // Extract tool name
    const nameMatch = toolBlock.match(/<tool_name>\s*(\w+)\s*<\/tool_name>/i) ||
                      toolBlock.match(/<name>\s*(\w+)\s*<\/name>/i);
    if (!nameMatch) return null;

    const toolName = nameMatch[1];
    const args = this.extractXmlParameters(toolBlock);

    return { tool: toolName, args };
  }

  /**
   * Extracts parameters from XML tool call format.
   * Handles multi-line values with leading/trailing whitespace.
   * @param text - XML text containing parameters
   * @returns Object with extracted parameters
   */
  private extractXmlParameters(text: string): Record<string, unknown> {
    const args: Record<string, unknown> = {};

    // Match <tool_parameters>...</tool_parameters> or <parameters>...</parameters> or <args>...</args>
    const paramsMatch = text.match(/<(?:tool_parameters|parameters|args)>([\s\S]*?)<\/(?:tool_parameters|parameters|args)>/i);
    const paramsBlock = paramsMatch ? paramsMatch[1] : text;

    // Extract individual parameters: <param_name>value</param_name>
    // Handle values that may span multiple lines with indentation
    const paramRegex = /<(\w+)>([\s\S]*?)<\/\1>/gi;
    let match;
    while ((match = paramRegex.exec(paramsBlock)) !== null) {
      const key = match[1].toLowerCase();
      // Clean multi-line values: trim each line and join, then trim the result
      let rawValue = match[2];
      // If the value is on multiple lines, normalize it
      let value: unknown = rawValue
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .join(' ')
        .trim();

      // If it was a single-line value, use that directly (trim already done)
      if (!rawValue.includes('\n')) {
        value = rawValue.trim();
      }

      // Skip meta tags
      if (['tool_name', 'name', 'tool_parameters', 'parameters', 'args'].includes(key)) continue;

      // Try to parse as number or boolean
      if (value === 'true') value = true;
      else if (value === 'false') value = false;
      else if (/^\d+$/.test(value as string)) value = parseInt(value as string, 10);

      args[key] = value;
    }

    return args;
  }

  /**
   * Determines if the response looks like a conversational response meant for the user.
   * @param text - Raw LLM response text
   * @returns True if this looks like a final answer
   */
  private looksLikeConversationalResponse(text: string): boolean {
    const trimmed = text.trim();

    // If it's very short, probably not a full response
    if (trimmed.length < 20) return false;

    // If it contains tool-like XML but we couldn't parse it, don't treat as conversation
    if (/<tool|<tool_name|<tool_call/i.test(trimmed)) return false;

    // If it contains a substantial JSON object (even without 'tool'), don't treat as conversation
    // This catches cases where the model outputs JSON args without the tool wrapper
    if (this.containsSubstantialJson(trimmed)) return false;

    // If it has clear conversational indicators
    const conversationalPatterns = [
      /^(I |I'm |I've |I'll |I can |I will |I would |I should |I need |Let me |Here |The |This |That |Yes|No|Sure|Okay|Based on|Looking at|After |Having )/i,
      /\b(you |your |you're |you've |you'll )\b/i,
      /\?\s*$/,  // Ends with a question
      /!\s*$/,   // Ends with exclamation
      /\.\s*$/,  // Ends with period (sentences)
    ];

    // Must match at least one conversational pattern and NOT look like code/data
    const looksConversational = conversationalPatterns.some(p => p.test(trimmed));
    const looksLikeCode = /^[\[\{]/.test(trimmed) || /^\s*(function|const|let|var|class|import|export|def |async )/i.test(trimmed);

    return looksConversational && !looksLikeCode;
  }

  /**
   * Cleans up text for final_answer output by removing internal XML tags and artifacts.
   * @param text - Raw text from LLM response
   * @returns Cleaned text suitable for display to user
   */
  private cleanFinalAnswerText(text: string): string {
    return text
      // Remove internal XML tags that leak into output
      .replace(/<\/?USER_OBJECTIVE>/gi, '')
      .replace(/<\/?ROLE>/gi, '')
      .replace(/<\/?thinking>/gi, '')
      .replace(/<\/?OUTPUT>/gi, '')
      .replace(/<\/?RESPONSE>/gi, '')
      // Remove any remaining XML-like tags that look internal
      .replace(/<\/?[A-Z_]{3,}>/g, '')
      // Clean up extra whitespace left behind
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /**
   * Checks if text contains a substantial JSON object (multi-line or with nested properties).
   * Used to avoid treating responses with JSON payloads as conversational.
   * @param text - Text to check
   * @returns True if substantial JSON is found
   */
  private containsSubstantialJson(text: string): boolean {
    // Look for JSON objects that span multiple lines or have nested structure
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return false;

    const jsonCandidate = jsonMatch[0];
    // If it's small (less than 50 chars), it's probably not a tool call payload
    if (jsonCandidate.length < 50) return false;

    // Try to parse it
    try {
      const parsed = JSON.parse(jsonCandidate);
      // If it has multiple keys or nested objects, it's substantial
      if (typeof parsed === 'object' && parsed !== null) {
        const keys = Object.keys(parsed);
        return keys.length >= 2;
      }
    } catch {
      // Not valid JSON, check if it looks like attempted JSON (has colons and quotes)
      return /"\w+":\s*["\[\{]/.test(jsonCandidate);
    }

    return false;
  }

  /**
   * Extracts the most useful JSON object from free-form text.
   * Prefers payloads that look like tool invocations (tool/name/function) over
   * ancillary payloads (e.g., args schemas) that appear later in the text.
   * @param text - The text to search for JSON objects
   * @returns The best-matching JSON string, or null if none found
   */
  private extractBestJsonObject(text: string): string | null {
    const firstBrace = text.indexOf('{');
    if (firstBrace === -1) return null;

    const closingBraces: number[] = [];
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '}') closingBraces.push(i);
    }
    if (closingBraces.length === 0) return null;

    const candidates: { json: string; parsed: unknown }[] = [];

    // Collect all parsable JSON snippets bounded by braces
    for (let endIdx = closingBraces.length - 1; endIdx >= 0; endIdx--) {
      const endPos = closingBraces[endIdx];
      let startPos = firstBrace;
      while (startPos !== -1 && startPos < endPos) {
        const candidate = text.substring(startPos, endPos + 1);
        try {
          const parsed = JSON.parse(candidate);
          candidates.push({ json: candidate, parsed });
        } catch {
          // ignore parse errors and keep scanning
        }
        startPos = text.indexOf('{', startPos + 1);
      }
    }

    if (candidates.length === 0) return null;

    // Helper to check if a parsed object looks like a tool call
    const looksLikeToolCall = (parsed: unknown): boolean => {
      if (!parsed || typeof parsed !== 'object') return false;
      const obj = parsed as Record<string, unknown>;

      const hasToolField = typeof obj.tool === 'string' && obj.tool.trim().length > 0;
      const hasNameArgs =
        typeof obj.name === 'string' &&
        (typeof obj.arguments === 'string' || typeof obj.arguments === 'object');
      const hasFunction =
        typeof obj.tool === 'object' &&
        obj.tool !== null &&
        typeof (obj.tool as Record<string, unknown>).function === 'object';

      // Array formats: [{"function": {"name": "...", "arguments": "..."}}, ...]
      if (Array.isArray(parsed) && parsed.length > 0) {
        const first = parsed[0] as Record<string, unknown>;
        if (first?.function && (first.function as Record<string, unknown>).name) return true;
      }

      return hasToolField || hasNameArgs || hasFunction;
    };

    // Prefer the first candidate that looks like a tool call (scanned from end to start)
    const toolCandidate = candidates.find((c) => looksLikeToolCall(c.parsed));
    if (toolCandidate) return toolCandidate.json;

    // If no tool-like candidate is found, return null so the caller can prompt the model to retry
    return null;
  }

  /**
   * Keypress handler for interrupt detection.
   */
  private onKeypress = (_str: string, key: { name: string; ctrl: boolean }): void => {
    if (key && (key.name === 'escape' || (key.ctrl && key.name === 'c'))) {
      this.triggerAbort();
    }
  };

  /**
   * SIGINT handler for Ctrl+C (fallback for when keypress doesn't work).
   */
  private onSigint = (): void => {
    this.triggerAbort();
  };

  /**
   * Triggers the abort controller to cancel the current operation.
   */
  private triggerAbort(): void {
    if (this.abortController && !this.abortController.signal.aborted) {
      this.abortController.abort();
    }
  }

  /**
   * Sets up the interrupt handler for user cancellation.
   * Uses SIGINT (Ctrl+C) only - avoids raw mode conflicts with inquirer.
   */
  private setupInterruptHandler(): void {
    // Use SIGINT handler for Ctrl+C - most reliable across platforms
    process.on('SIGINT', this.onSigint);

    // Set up keypress handler ONCE without raw mode manipulation
    // Raw mode conflicts with inquirer and causes cursor lag
    if (process.stdin.isTTY && !keypressEventsInitialized) {
      try {
        readline.emitKeypressEvents(process.stdin);
        keypressEventsInitialized = true;
        // Add keypress listener but DON'T set raw mode - let inquirer manage it
        process.stdin.on('keypress', this.onKeypress);
      } catch (e) {
        // SIGINT will still work as fallback
        logger.warn("Could not set up keypress handler", e);
      }
    }
  }

  /**
   * Cleans up the interrupt handler and restores terminal state.
   */
  private cleanupInterruptHandler(): void {
    // Remove SIGINT handler
    process.removeListener('SIGINT', this.onSigint);

    // Remove keypress handler but DON'T touch raw mode or pause stdin
    // Let inquirer manage terminal state to avoid conflicts
    if (process.stdin.isTTY) {
      try {
        process.stdin.removeListener('keypress', this.onKeypress);
      } catch {
        // Ignore errors during cleanup
      }
    }
  }
}
