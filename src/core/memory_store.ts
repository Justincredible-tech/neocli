// src/core/memory_store.ts
/**
 * Memory Store Module
 * Implements semantic long-term memory with vector embeddings.
 * Supports storing facts, episodes, and preferences with similarity search.
 */
import * as fs from 'fs';
import { router } from './llm.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { cosineSimilarity } from '../utils/math.js';

/** Types of memory fragments */
export type MemoryType = 'FACT' | 'EPISODE' | 'PREFERENCE';

/** Structure of a memory fragment */
interface MemoryFragment {
  id: string;
  text: string;
  type: MemoryType;
  tags: string[];
  timestamp: string;
  embedding?: number[];
}

/**
 * MemoryStore - Semantic long-term memory implementation.
 * Uses vector embeddings for similarity-based retrieval.
 */
export class MemoryStore {
  private memories: MemoryFragment[] = [];
  private readonly memoryDir: string;
  private readonly memoryFile: string;
  private readonly similarityThreshold: number;
  private readonly maxSearchResults: number;

  constructor() {
    this.memoryDir = config.paths.memoryDir;
    this.memoryFile = config.paths.ltmFile;
    this.similarityThreshold = config.memory.similarityThreshold;
    this.maxSearchResults = config.memory.maxSearchResults;

    this.ensureDirectoryExists();
    this.load();
  }

  /**
   * Ensures the memory directory exists.
   */
  private ensureDirectoryExists(): void {
    try {
      if (!fs.existsSync(this.memoryDir)) {
        fs.mkdirSync(this.memoryDir, { recursive: true });
      }
    } catch (e) {
      logger.error("Failed to create memory directory", e);
    }
  }

  /**
   * Loads memories from persistent storage.
   */
  private load(): void {
    try {
      if (fs.existsSync(this.memoryFile)) {
        const data = fs.readFileSync(this.memoryFile, 'utf-8');
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed)) {
          this.memories = parsed;
          logger.info("Memory store loaded", { count: this.memories.length });
        }
      }
    } catch (e) {
      logger.warn("Failed to load memory store", e);
      this.memories = [];
    }
  }

  /**
   * Saves memories to persistent storage.
   */
  private save(): void {
    try {
      fs.writeFileSync(this.memoryFile, JSON.stringify(this.memories, null, 2));
    } catch (e) {
      logger.error("Failed to save memory store", e);
    }
  }

  /**
   * Generates a unique ID for a memory fragment.
   * @returns Unique identifier string
   */
  private generateId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 10);
    return `${timestamp}-${random}`;
  }

  /**
   * Stores a new memory with optional embedding.
   * @param text - The memory text to store
   * @param type - The type of memory (FACT, EPISODE, PREFERENCE)
   * @param tags - Optional tags for categorization
   * @returns The ID of the stored memory
   */
  async store(text: string, type: MemoryType, tags: string[] = []): Promise<string> {
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      throw new Error("Memory text cannot be empty");
    }

    const embedding = await router.embed(text);

    const fragment: MemoryFragment = {
      id: this.generateId(),
      text: text.trim(),
      type,
      tags: tags.filter(t => typeof t === 'string'),
      timestamp: new Date().toISOString(),
      embedding: embedding.length > 0 ? embedding : undefined
    };

    this.memories.push(fragment);
    this.save();

    logger.info("Memory stored", { id: fragment.id, type });
    return fragment.id;
  }

  /**
   * Searches memories using semantic similarity.
   * @param query - The search query
   * @param limit - Maximum number of results
   * @returns Array of formatted memory strings with relevance scores
   */
  async search(query: string, limit?: number): Promise<string[]> {
    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return [];
    }

    const queryEmbedding = await router.embed(query);
    if (!queryEmbedding || queryEmbedding.length === 0) {
      logger.warn("Failed to generate embedding for query");
      return [];
    }

    const effectiveLimit = Math.min(limit || this.maxSearchResults, this.maxSearchResults);

    // Calculate similarity scores
    // Filter first to get only memories with valid embeddings, then map with type guard
    const memoriesWithEmbeddings = this.memories.filter(
      (mem): mem is MemoryFragment & { embedding: number[] } =>
        Array.isArray(mem.embedding) && mem.embedding.length > 0
    );

    const scored = memoriesWithEmbeddings
      .map(mem => ({
        mem,
        score: cosineSimilarity(queryEmbedding, mem.embedding)
      }))
      .filter(item => item.score > this.similarityThreshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, effectiveLimit);

    return scored.map(item =>
      `[${item.mem.type}] ${item.mem.text} (Relevance: ${item.score.toFixed(2)})`
    );
  }

  /**
   * Retrieves all facts and preferences for the system prompt.
   * @returns Array of formatted fact strings
   */
  getFacts(): string[] {
    return this.memories
      .filter(m => m.type === 'FACT' || m.type === 'PREFERENCE')
      .map(m => `- ${m.text}`);
  }

  /**
   * Retrieves memories by type.
   * @param type - The type of memories to retrieve
   * @returns Array of memory fragments
   */
  getByType(type: MemoryType): MemoryFragment[] {
    return this.memories.filter(m => m.type === type);
  }

  /**
   * Deletes a memory by ID.
   * @param id - The ID of the memory to delete
   * @returns True if memory was found and deleted
   */
  delete(id: string): boolean {
    const index = this.memories.findIndex(m => m.id === id);
    if (index === -1) return false;

    this.memories.splice(index, 1);
    this.save();
    logger.info("Memory deleted", { id });
    return true;
  }

  /**
   * Clears all memories.
   */
  clear(): void {
    this.memories = [];
    this.save();
    logger.info("Memory store cleared");
  }

  /**
   * Gets the total number of stored memories.
   */
  get count(): number {
    return this.memories.length;
  }
}

/** Singleton instance of the memory store */
export const memory = new MemoryStore();