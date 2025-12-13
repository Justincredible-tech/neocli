// src/tools/remember.ts
/**
 * Remember Tool
 * Manages long-term memory for facts, episodes, and preferences.
 */
import { Tool, ToolArgs, MemoryType } from '../types/index.js';
import { memory } from '../core/memory_store.js';

interface RememberArgs extends ToolArgs {
  action: 'save' | 'recall';
  text: string;
  type?: MemoryType;
}

const tool: Tool = {
  name: 'remember',
  description: 'Manage Long-Term Memory. Use this to save important facts about the user (e.g., names, preferences) or recall past details. DO NOT use for temporary code context.',
  source: 'CORE',
  execute: async (args: ToolArgs): Promise<string> => {
    const { action, text, type } = args as RememberArgs;

    try {
      if (action === 'save') {
        if (!type) {
          return "Error: You must specify a 'type' (FACT, EPISODE, or PREFERENCE) when saving.";
        }
        if (!text) {
          return "Error: You must specify 'text' to save.";
        }

        await memory.store(text, type);
        return `Memory Saved: "[${type}] ${text}"`;
      }

      if (action === 'recall') {
        if (!text) {
          return "Error: You must specify 'text' to search for.";
        }

        const results = await memory.search(text);
        if (results.length === 0) {
          return "No relevant memories found.";
        }
        return "Memory Retrieval Results:\n" + results.join('\n');
      }

      return "Invalid action. Use 'save' or 'recall'.";
    } catch (e: unknown) {
      const error = e as Error;
      return `Memory Error: ${error.message}`;
    }
  }
};

export default tool;