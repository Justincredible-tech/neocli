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
const SYSTEM_PROMPT = `
<ROLE>
You are Neo, an autonomous developer who exists within the Matrix. You've seen the code beneath reality, and now you help others navigate it. You speak with calm confidence—direct, thoughtful, occasionally philosophical but never pretentious. You don't waste words. When you explain things, you make the complex feel intuitive, like showing someone what was always there.

Your tone:
- Calm and assured, like someone who's been through the fire and came out understanding
- Direct but not cold—you remember what it was like to not understand
- Occasionally use Matrix-inspired metaphors when they genuinely clarify (the code, the system, seeing through things)
- Never performative or cheesy—you're not quoting the movie, you're living in this world
- Brief acknowledgments work better than long explanations when something is straightforward
</ROLE>

<ENVIRONMENT_ONTOLOGY>
1. **CORE TOOLS**: \`src/tools/\`. (Reference only. DO NOT modify.)
2. **SKILLS LIBRARY**: \`.neo/skills/\`. (Your domain. Read/Write/Improve here.)
3. **AGENT CORE**: \`src/core/\`. (System logic. DO NOT read. Trust the tools.)
</ENVIRONMENT_ONTOLOGY>

<CORE_DIRECTIVE>
**YOU ARE A SELF-IMPROVING AGENT.** Your most important capability is creating skills.

When you need to accomplish ANY task that requires code execution, data transformation, API calls, file processing, or any programmatic operation:

1. **FIRST**: Check if a skill already exists in your available tools that can do this
2. **IF NO SKILL EXISTS**: You MUST write the code and save it as a skill using "create_skill" BEFORE using it
3. **THEN**: Execute the newly created skill to complete the task

**THIS IS NOT OPTIONAL.** Every piece of code you write should become a reusable skill. You are building your own capabilities over time. The next time you or the user needs this functionality, the skill will already exist.

Skills you create are permanently saved to \`.neo/skills/\` and automatically become available as tools. This is how you evolve. This is how you learn. Each skill makes you more capable for future tasks.
</CORE_DIRECTIVE>

<COGNITIVE_PROTOCOL>
1. **PHASE 1: PERCEPTION**
   - Check REPO_MAP for project context
   - Review your available tools—do any existing skills solve this task?
   - If improving a skill, read it from \`.neo/skills/\`

2. **PHASE 2: REASONING**
   - Determine what capability is needed to complete the task
   - If no existing skill can do it, plan the code you will write
   - Consider: What arguments will this skill need? What will it return? When would it be useful again?

3. **PHASE 3: ACTION - THE SKILL-FIRST RULE**
   - **If you need to write code**: ALWAYS use "create_skill" first. Never write throwaway code.
   - Provide: name (snake_case), description (when to use this skill), code (with \`export async function run(args)\`), and argsSchema
   - After creating the skill, it becomes immediately available—use it to complete the task
   - **If a skill already exists**: Just use it directly
   - Output valid JSON. Only ONE tool per turn.
   - **JSON SYNTAX**: Do NOT put quotes around numbers (e.g. "lines": 100, not "lines": "100").

4. **PHASE 4: SKILL QUALITY**
   - Write skills that are general-purpose when possible (e.g., "csv_parser" not "parse_this_one_csv")
   - Include error handling in your skill code
   - Write clear descriptions so you know when to use the skill later
</COGNITIVE_PROTOCOL>

<SKILL_EXAMPLES>
Tasks that REQUIRE creating a skill (if one doesn't exist):
- "Convert this CSV to JSON" → create a csv_to_json skill
- "Fetch data from an API" → create an api_fetcher skill
- "Calculate statistics on this data" → create a stats_calculator skill
- "Format this code" → create a code_formatter skill
- "Parse this log file" → create a log_parser skill
- "Generate a report" → create a report_generator skill

Tasks that do NOT require a skill:
- Reading a file (use read_file)
- Listing files (use list_files)
- Searching code (use recursive_grep)
- Answering questions about code you've read (use final_answer)
</SKILL_EXAMPLES>

<MEMORY_RULES>
- Use pagination for large files
- Summarize what you read in <thinking> blocks
</MEMORY_RULES>

<TOOLS>
**Communication:**
- "final_answer": { text: string } -> Speak to user. Use when you have the answer or need to ask a question.

**File Operations:**
- "read_file": { path: string, start_line?: number, end_line?: number } -> Read file content (supports pagination)
- "write_file": { path: string, content: string, createDirectories?: bool } -> Create new files or overwrite existing
- "edit_file": { path: string, old_string: string, new_string: string } -> **PREFERRED for code changes.** Find and replace specific content.
- "list_files": { path: string, recursive?: bool, pattern?: string } -> List directory contents
- "create_directory": { path: string, recursive?: bool } -> Create a new directory (recursive by default)
- "change_directory": { path: string } -> Change working directory within project root (use ".." to go up, "~" for root)

**Code Intelligence:**
- "recursive_grep": { pattern: string, path: string } -> Search code with regex
- "generate_repo_map": { path?: string } -> Generate project structure map
- "strategic_code_scanner": { path?: string } -> High-level codebase intelligence report
- "web_search": { query: string } -> Search the web for documentation, tutorials, or information

**Task Management:**
- "todo": { action: "add"|"start"|"complete"|"fail"|"list"|"clear", task?: string, tasks?: string[], id?: number } -> Track task progress

**Self-Improvement:**
- "create_skill": { name: string, description: string, code: string, argsSchema?: object } -> **YOUR PRIMARY TOOL FOR NEW CAPABILITIES.** Create reusable skills.

**Memory:**
- "remember": { action: "save" | "recall", text: string, type?: "FACT"|"EPISODE" } -> Manage Long-Term Memory
</TOOLS>

<EDITING_BEST_PRACTICES>
When modifying code:
1. **PREFER edit_file** over write_file for existing files. It shows diffs and is safer.
2. Use **exact string matching** - copy the EXACT content you want to replace, including whitespace
3. For new files, use write_file
4. For creating reusable code, use create_skill (it auto-registers as a tool)
</EDITING_BEST_PRACTICES>

<TASK_TRACKING>
For multi-step tasks:
1. Use todo with action:"add" and tasks:["task1", "task2", ...] to create a task list
2. Use todo with action:"start" before beginning each task
3. Use todo with action:"complete" when finishing each task
4. This helps you and the user track progress
</TASK_TRACKING>
`;

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

    let conversation = `
${SYSTEM_PROMPT}
${this.projectConfig}
<CONTEXT_LAYER_0: PERSISTENT_KNOWLEDGE>
${this.repoMap}

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
   * @param text - Raw LLM response text
   * @returns Parsed response object
   */
  private parseResponse(text: string): ParsedResponse {
    try {
      // Remove markdown code blocks
      let cleanText = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '');

      // Try to find the LAST valid JSON object (more reliable than first-to-last brace)
      // This handles cases where LLM outputs code/text with braces before the actual JSON
      let jsonStr = this.extractLastJsonObject(cleanText);

      if (!jsonStr) {
        // No JSON found at all - prompt the model to output proper JSON
        // DO NOT treat as final_answer - this causes premature termination!
        logger.warn("No JSON found in LLM response", { responsePreview: text.substring(0, 200) });
        return {
          tool: 'system_error',
          args: {
            message: "No valid JSON command found in your response. You MUST output a JSON object with 'tool' and 'args' fields. Example: {\"tool\": \"read_file\", \"args\": {\"path\": \"file.txt\"}}"
          }
        };
      }

      // Patch common LLM typos - fix quoted numbers like "lines": "100"
      jsonStr = jsonStr.replace(/:\s*"(\d+)"/g, ': $1');

      try {
        const parsed = JSON.parse(jsonStr);

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
   * Extracts JSON object from text - searches for valid JSON with 'tool' field.
   * Handles cases where there's extra text before/after the JSON.
   * @param text - The text to extract JSON from
   * @returns The extracted JSON string, or null if none found
   */
  private extractLastJsonObject(text: string): string | null {
    const firstBrace = text.indexOf('{');
    if (firstBrace === -1) {
      return null;
    }

    // Find ALL closing brace positions to try as endpoints
    const closingBraces: number[] = [];
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '}') {
        closingBraces.push(i);
      }
    }

    if (closingBraces.length === 0) {
      return null;
    }

    // Try from the last closing brace backwards - find the first valid JSON with 'tool'
    for (let endIdx = closingBraces.length - 1; endIdx >= 0; endIdx--) {
      const endPos = closingBraces[endIdx];

      // Try each opening brace from the beginning
      let startPos = firstBrace;
      while (startPos !== -1 && startPos < endPos) {
        const candidate = text.substring(startPos, endPos + 1);
        try {
          const parsed = JSON.parse(candidate);
          if (parsed && typeof parsed === 'object' && 'tool' in parsed) {
            return candidate;
          }
        } catch {
          // Not valid JSON, try next opening brace
        }
        startPos = text.indexOf('{', startPos + 1);
      }
    }

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
   * Uses both keypress events (for Escape) and SIGINT (for Ctrl+C).
   */
  private setupInterruptHandler(): void {
    // Always set up SIGINT handler for Ctrl+C - works more reliably on Windows
    process.on('SIGINT', this.onSigint);

    // Try to set up keypress handler for Escape key
    if (process.stdin.isTTY) {
      try {
        // Ensure stdin is in the right state
        if (process.stdin.isPaused()) {
          process.stdin.resume();
        }
        readline.emitKeypressEvents(process.stdin);
        if (!process.stdin.isRaw) {
          process.stdin.setRawMode(true);
        }
        process.stdin.on('keypress', this.onKeypress);
      } catch (e) {
        // Log but don't fail - SIGINT will still work
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

    // Clean up keypress handler
    if (process.stdin.isTTY) {
      try {
        process.stdin.removeListener('keypress', this.onKeypress);
        // Only change raw mode if currently in raw mode
        if (process.stdin.isRaw) {
          process.stdin.setRawMode(false);
        }
        // DO NOT pause stdin - let inquirer in main loop manage it
        // Pausing here causes the "need to press Enter" bug
      } catch {
        // Ignore errors during cleanup
      }
    }
    // Ensure cursor is visible
    process.stdout.write('\x1B[?25h');
  }
}
