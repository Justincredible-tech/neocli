// src/core/llm.ts
/**
 * LLM Router Module
 * Handles communication with the Ollama API for text generation and embeddings.
 * Implements retry logic, timeout handling, and error recovery.
 */
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

/** Response structure from Ollama chat API */
interface OllamaChatResponse {
  message: {
    role: string;
    content: string;
  };
  done: boolean;
  total_duration?: number;
  eval_count?: number;
}

/** Streaming chunk from Ollama */
interface OllamaStreamChunk {
  message?: {
    role: string;
    content: string;
  };
  done: boolean;
  total_duration?: number;
  eval_count?: number;
}

/** Callback for streaming chunks */
export type StreamCallback = (chunk: string, done: boolean) => void;

/** Response structure from Ollama embeddings API */
interface OllamaEmbeddingResponse {
  embedding: number[];
}

/**
 * ModelRouter - Handles LLM API communication.
 * Supports text generation and embeddings via Ollama.
 */
export class ModelRouter {
  private readonly host: string;
  private readonly defaultModel: string;
  private readonly fallbackModel: string;
  private readonly embeddingModel: string;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private readonly temperature: number;
  private readonly contextWindowSize: number;
  private readonly stopSequences: string[];

  constructor() {
    this.host = config.llm.host;
    this.defaultModel = config.llm.defaultModel;
    this.fallbackModel = config.llm.fallbackModel;
    this.embeddingModel = config.llm.embeddingModel;
    this.maxRetries = config.llm.maxRetries;
    this.timeoutMs = config.llm.timeoutMs;
    this.temperature = config.llm.temperature;
    this.contextWindowSize = config.llm.contextWindowSize;
    this.stopSequences = config.llm.stopSequences;
  }

  /**
   * Creates an AbortSignal that combines user signal with timeout.
   * @param userSignal - Optional user-provided abort signal
   * @returns Combined abort signal
   */
  private createTimeoutSignal(userSignal?: AbortSignal): { signal: AbortSignal; clear: () => void } {
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => {
      timeoutController.abort(new Error('Request timeout'));
    }, this.timeoutMs);

    // If user signal aborts, also abort our controller
    if (userSignal) {
      userSignal.addEventListener('abort', () => {
        clearTimeout(timeoutId);
        timeoutController.abort(userSignal.reason);
      });
    }

    // Clean up timeout when controller aborts
    timeoutController.signal.addEventListener('abort', () => {
      clearTimeout(timeoutId);
    });

    const clear = (): void => clearTimeout(timeoutId);

    return { signal: timeoutController.signal, clear };
  }

  /**
   * Generates text using the LLM.
   * @param prompt - The user prompt/conversation
   * @param system - The system prompt
   * @param signal - Optional abort signal for cancellation
   * @returns Generated text response
   * @throws Error if all retries fail or request is aborted
   */
  async generate(prompt: string, system: string, signal?: AbortSignal): Promise<string> {
    const attemptModel = async (modelName: string): Promise<string> => {
      let attempt = 0;
      let lastError: Error | null = null;

      while (attempt < this.maxRetries) {
        try {
          if (signal?.aborted) {
            throw new Error("ABORTED");
          }

          const { signal: combinedSignal, clear: clearTimeoutFn } = this.createTimeoutSignal(signal);

          try {
            const response = await fetch(`${this.host}/api/chat`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                model: modelName,
                messages: [
                  { role: 'system', content: system },
                  { role: 'user', content: prompt }
                ],
                stream: false,
                options: {
                  temperature: this.temperature,
                  num_ctx: this.contextWindowSize,
                  stop: this.stopSequences
                }
              }),
              signal: combinedSignal
            });

            if (!response.ok) {
              const errorText = await response.text().catch(() => 'Unknown error');
              throw new Error(`Ollama API Error (${response.status}): ${response.statusText}. ${errorText}`);
            }

            const data = await response.json() as OllamaChatResponse;

            if (!data.message?.content) {
              throw new Error('Invalid response format: missing message content');
            }

            logger.info("LLM generation complete", {
              model: modelName,
              tokenCount: data.eval_count,
              duration: data.total_duration
            });

            return data.message.content;
          } finally {
            clearTimeoutFn();
          }

        } catch (e: unknown) {
          const error = e as Error;

          if (error.name === 'AbortError' || error.message === 'ABORTED' || error.message === 'Request timeout') {
            if (error.message === 'Request timeout') {
              logger.warn("LLM request timed out", { attempt, timeout: this.timeoutMs, model: modelName });
              throw new Error("Request timed out. The model may be overloaded or the prompt too long.");
            }
            throw new Error("ABORTED");
          }

          lastError = error;
          attempt++;

          if (attempt < this.maxRetries) {
            const backoffMs = 1000 * Math.pow(2, attempt - 1);
            logger.warn("LLM request failed, retrying", { attempt, backoffMs, model: modelName, error: error.message });
            await new Promise(resolve => setTimeout(resolve, backoffMs));
          }
        }
      }

      logger.error("LLM request failed after all retries", { model: modelName, error: lastError?.message });
      throw lastError || new Error('LLM request failed');
    };

    // Try default model, then fallback if configured
    let attempt = 0;
    let lastError: Error | null = null;

    try {
      return await attemptModel(this.defaultModel);
    } catch (primaryError) {
      lastError = primaryError as Error;

      const shouldFallback = this.fallbackModel && this.fallbackModel !== this.defaultModel;
      if (shouldFallback) {
        logger.warn("Primary model failed, attempting fallback model", {
          primary: this.defaultModel,
          fallback: this.fallbackModel,
          error: lastError?.message
        });
        try {
          return await attemptModel(this.fallbackModel);
        } catch (fallbackError) {
          lastError = fallbackError as Error;
        }
      }
    }

    // All attempts exhausted
    throw lastError || new Error('LLM request failed');
  }

  /**
   * Generates text with streaming response.
   * @param prompt - The user prompt/conversation
   * @param system - The system prompt
   * @param onChunk - Callback for each chunk received
   * @param signal - Optional abort signal for cancellation
   * @returns Full generated text
   */
  async generateStream(
    prompt: string,
    system: string,
    onChunk: StreamCallback,
    signal?: AbortSignal
  ): Promise<string> {
    try {
      if (signal?.aborted) {
        throw new Error("ABORTED");
      }

      const { signal: combinedSignal, clear: clearTimeoutFn } = this.createTimeoutSignal(signal);

      try {
        const response = await fetch(`${this.host}/api/chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: this.defaultModel,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: prompt }
            ],
            stream: true,
            options: {
              temperature: this.temperature,
              num_ctx: this.contextWindowSize,
              stop: this.stopSequences
            }
          }),
          signal: combinedSignal
        });

        if (!response.ok) {
          const errorText = await response.text().catch(() => 'Unknown error');
          throw new Error(`Ollama API Error (${response.status}): ${response.statusText}. ${errorText}`);
        }

        if (!response.body) {
          throw new Error('No response body for streaming');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullContent = '';

        while (true) {
          const { done, value } = await reader.read();

          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n').filter(line => line.trim());

          for (const line of lines) {
            try {
              const data = JSON.parse(line) as OllamaStreamChunk;

              if (data.message?.content) {
                fullContent += data.message.content;
                onChunk(data.message.content, false);
              }

              if (data.done) {
                onChunk('', true);
                logger.info("LLM streaming complete", {
                  model: this.defaultModel,
                  tokenCount: data.eval_count,
                  duration: data.total_duration
                });
              }
            } catch {
              // Skip invalid JSON lines
            }
          }
        }

        return fullContent;

      } finally {
        clearTimeoutFn();
      }

    } catch (e: unknown) {
      const error = e as Error;

      if (error.name === 'AbortError' || error.message === 'ABORTED' || error.message === 'Request timeout') {
        if (error.message === 'Request timeout') {
          throw new Error("Request timed out. The model may be overloaded or the prompt too long.");
        }
        throw new Error("ABORTED");
      }

      throw error;
    }
  }

  /**
   * Generates embeddings for text.
   * @param text - The text to embed
   * @returns Array of embedding values, or empty array on failure
   */
  async embed(text: string): Promise<number[]> {
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return [];
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout for embeddings

      const response = await fetch(`${this.host}/api/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.embeddingModel,
          prompt: text.trim()
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        logger.warn("Embedding request failed", { status: response.status });
        return [];
      }

      const data = await response.json() as OllamaEmbeddingResponse;

      if (!Array.isArray(data.embedding)) {
        logger.warn("Invalid embedding response format");
        return [];
      }

      return data.embedding;
    } catch (e: unknown) {
      const error = e as Error;
      logger.warn("Embedding generation failed", { error: error.message });
      return [];
    }
  }

  /**
   * Checks if the Ollama server is available.
   * @returns True if server is reachable
   */
  async isAvailable(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${this.host}/api/tags`, {
        method: 'GET',
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      return response.ok;
    } catch {
      return false;
    }
  }
}

/** Singleton instance of the model router */
export const router = new ModelRouter();
