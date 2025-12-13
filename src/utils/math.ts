// src/utils/math.ts
/**
 * Math Utilities
 * Primarily used for vector embeddings and cosine similarity.
 */

/**
 * Calculates cosine similarity between two vectors.
 * @param vecA - First vector
 * @param vecB - Second vector
 * @returns Similarity score between -1 and 1, or 0 if vectors are invalid
 */
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (!vecA || !vecB || vecA.length !== vecB.length || vecA.length === 0) {
    return 0;
  }

  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    magA += vecA[i] * vecA[i];
    magB += vecB[i] * vecB[i];
  }

  const magnitude = Math.sqrt(magA) * Math.sqrt(magB);
  return magnitude === 0 ? 0 : dot / magnitude;
}

/**
 * Calculates Euclidean distance between two vectors.
 * @param vecA - First vector
 * @param vecB - Second vector
 * @returns Distance value, or Infinity if vectors are invalid
 */
export function euclideanDistance(vecA: number[], vecB: number[]): number {
  if (!vecA || !vecB || vecA.length !== vecB.length || vecA.length === 0) {
    return Infinity;
  }

  let sum = 0;
  for (let i = 0; i < vecA.length; i++) {
    const diff = vecA[i] - vecB[i];
    sum += diff * diff;
  }

  return Math.sqrt(sum);
}

/**
 * Normalizes a vector to unit length.
 * @param vec - The vector to normalize
 * @returns Normalized vector
 */
export function normalize(vec: number[]): number[] {
  if (!vec || vec.length === 0) return [];

  let magnitude = 0;
  for (const v of vec) {
    magnitude += v * v;
  }
  magnitude = Math.sqrt(magnitude);

  if (magnitude === 0) return vec.map(() => 0);

  return vec.map(v => v / magnitude);
}

/**
 * Smart Chunking
 * Splits text into overlapping chunks for embedding.
 * @param text - The text to chunk
 * @param maxChunkSize - Maximum size of each chunk (default: 500)
 * @param overlap - Number of characters to overlap between chunks (default: 50)
 * @returns Array of text chunks
 */
export function chunkText(text: string, maxChunkSize: number = 500, overlap: number = 50): string[] {
  if (!text) return [];

  // Normalize newlines
  const cleanText = text.replace(/\r\n/g, '\n');
  const chunks: string[] = [];

  // Calculate step size
  const step = Math.max(1, maxChunkSize - overlap);

  for (let i = 0; i < cleanText.length; i += step) {
    const chunk = cleanText.substring(i, i + maxChunkSize);
    if (chunk.trim().length > 0) {
      chunks.push(chunk);
    }
  }

  return chunks;
}

/**
 * Clamps a number between a minimum and maximum value.
 * @param value - The value to clamp
 * @param min - Minimum value
 * @param max - Maximum value
 * @returns Clamped value
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
