/* NEO_SKILL_META
{
  "name": "base64_encoder",
  "description": "Encode/decode Base64, URL encoding, HTML entities. Generate hashes (MD5, SHA256, SHA512) and UUIDs. Useful for data transformation and security.",
  "argsSchema": {
    "type": "object",
    "properties": {
      "action": {
        "type": "string",
        "enum": ["base64_encode", "base64_decode", "url_encode", "url_decode", "html_encode", "html_decode", "hash", "uuid"],
        "description": "Encoding/decoding action to perform"
      },
      "input": { "type": "string", "description": "Input string to process" },
      "options": {
        "type": "object",
        "properties": {
          "algorithm": { "type": "string", "enum": ["md5", "sha1", "sha256", "sha512"], "description": "Hash algorithm (for hash action)" },
          "urlSafe": { "type": "boolean", "description": "Use URL-safe Base64 (default: false)" },
          "uuidVersion": { "type": "string", "enum": ["v4", "v1"], "description": "UUID version (default: v4)" },
          "count": { "type": "number", "description": "Number of UUIDs to generate (default: 1)" }
        }
      }
    },
    "required": ["action"]
  }
}
NEO_SKILL_META */

import { createHash, randomUUID, randomBytes } from 'crypto';
import { v4 as uuidv4 } from 'uuid';

interface EncoderArgs {
  action: 'base64_encode' | 'base64_decode' | 'url_encode' | 'url_decode' | 'html_encode' | 'html_decode' | 'hash' | 'uuid';
  input?: string;
  options?: {
    algorithm?: 'md5' | 'sha1' | 'sha256' | 'sha512';
    urlSafe?: boolean;
    uuidVersion?: 'v4' | 'v1';
    count?: number;
  };
}

// HTML entities mapping
const HTML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '/': '&#x2F;',
  '`': '&#x60;',
  '=': '&#x3D;'
};

const HTML_ENTITIES_REVERSE: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&#x27;': "'",
  '&#x2F;': '/',
  '&#x60;': '`',
  '&#x3D;': '=',
  '&nbsp;': ' ',
  '&copy;': '©',
  '&reg;': '®',
  '&trade;': '™',
  '&euro;': '€',
  '&pound;': '£',
  '&yen;': '¥'
};

export async function run(args: EncoderArgs): Promise<string> {
  const { action, input, options = {} } = args;

  if (!action) {
    return 'Error: action is required';
  }

  // UUID doesn't require input
  if (action !== 'uuid' && !input) {
    return 'Error: input is required for this action';
  }

  try {
    switch (action) {
      case 'base64_encode':
        return base64Encode(input!, options.urlSafe);
      case 'base64_decode':
        return base64Decode(input!, options.urlSafe);
      case 'url_encode':
        return urlEncode(input!);
      case 'url_decode':
        return urlDecode(input!);
      case 'html_encode':
        return htmlEncode(input!);
      case 'html_decode':
        return htmlDecode(input!);
      case 'hash':
        return generateHash(input!, options.algorithm || 'sha256');
      case 'uuid':
        return generateUUID(options.uuidVersion || 'v4', options.count || 1);
      default:
        return `Error: Unknown action "${action}"`;
    }
  } catch (e: unknown) {
    return `Error: ${(e as Error).message}`;
  }
}

function base64Encode(input: string, urlSafe: boolean = false): string {
  const encoded = Buffer.from(input, 'utf-8').toString('base64');

  const result = urlSafe
    ? encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
    : encoded;

  return formatOutput('Base64 Encode', input, result, {
    'URL Safe': urlSafe ? 'Yes' : 'No',
    'Output Length': result.length.toString()
  });
}

function base64Decode(input: string, urlSafe: boolean = false): string {
  let normalized = input;

  if (urlSafe) {
    normalized = normalized.replace(/-/g, '+').replace(/_/g, '/');
    // Add padding if needed
    const padding = 4 - (normalized.length % 4);
    if (padding !== 4) {
      normalized += '='.repeat(padding);
    }
  }

  const decoded = Buffer.from(normalized, 'base64').toString('utf-8');

  return formatOutput('Base64 Decode', input, decoded, {
    'URL Safe Mode': urlSafe ? 'Yes' : 'No'
  });
}

function urlEncode(input: string): string {
  const encoded = encodeURIComponent(input);

  return formatOutput('URL Encode', input, encoded, {
    'Characters Encoded': (input.length - (encoded.match(/[a-zA-Z0-9\-_.~]/g) || []).length).toString()
  });
}

function urlDecode(input: string): string {
  const decoded = decodeURIComponent(input);

  return formatOutput('URL Decode', input, decoded);
}

function htmlEncode(input: string): string {
  const encoded = input.replace(/[&<>"'`=\/]/g, char => HTML_ENTITIES[char] || char);

  return formatOutput('HTML Encode', input, encoded, {
    'Entities Created': (encoded.match(/&[^;]+;/g) || []).length.toString()
  });
}

function htmlDecode(input: string): string {
  let decoded = input;

  // Replace named entities
  for (const [entity, char] of Object.entries(HTML_ENTITIES_REVERSE)) {
    decoded = decoded.replace(new RegExp(entity, 'g'), char);
  }

  // Replace numeric entities (&#123; and &#x7B;)
  decoded = decoded.replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)));
  decoded = decoded.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

  return formatOutput('HTML Decode', input, decoded);
}

function generateHash(input: string, algorithm: string): string {
  const validAlgorithms = ['md5', 'sha1', 'sha256', 'sha512'];

  if (!validAlgorithms.includes(algorithm)) {
    return `Error: Invalid algorithm. Use: ${validAlgorithms.join(', ')}`;
  }

  const hash = createHash(algorithm).update(input).digest('hex');

  const lines: string[] = [];
  lines.push(`=== Hash Generation ===`);
  lines.push(`Algorithm: ${algorithm.toUpperCase()}`);
  lines.push(`Input: "${input.substring(0, 50)}${input.length > 50 ? '...' : ''}"`);
  lines.push(`Input Length: ${input.length} characters`);
  lines.push('');
  lines.push(`Hash: ${hash}`);
  lines.push(`Hash Length: ${hash.length} characters (${hash.length * 4} bits)`);

  // Also show other common hashes for comparison
  if (algorithm !== 'md5') {
    lines.push('');
    lines.push('Other hashes for reference:');
    for (const algo of validAlgorithms) {
      if (algo !== algorithm) {
        const otherHash = createHash(algo).update(input).digest('hex');
        lines.push(`  ${algo.toUpperCase()}: ${otherHash}`);
      }
    }
  }

  return lines.join('\n');
}

function generateUUID(version: string, count: number): string {
  const lines: string[] = [];
  lines.push(`=== UUID Generation ===`);
  lines.push(`Version: ${version.toUpperCase()}`);
  lines.push(`Count: ${count}`);
  lines.push('');

  const uuids: string[] = [];

  for (let i = 0; i < Math.min(count, 100); i++) {
    let uuid: string;

    if (version === 'v4') {
      // Use uuid library for proper v4
      try {
        uuid = uuidv4();
      } catch {
        // Fallback to crypto.randomUUID if uuid package fails
        uuid = randomUUID();
      }
    } else {
      // Simple v1-like UUID (timestamp-based simulation)
      const timestamp = Date.now().toString(16).padStart(12, '0');
      const random = randomBytes(10).toString('hex');
      uuid = `${timestamp.slice(0, 8)}-${timestamp.slice(8, 12)}-1${random.slice(0, 3)}-${random.slice(3, 7)}-${random.slice(7, 19)}`;
    }

    uuids.push(uuid);
  }

  if (count === 1) {
    lines.push(`UUID: ${uuids[0]}`);
  } else {
    lines.push('Generated UUIDs:');
    for (let i = 0; i < uuids.length; i++) {
      lines.push(`  ${i + 1}. ${uuids[i]}`);
    }
  }

  if (count > 100) {
    lines.push('');
    lines.push('Note: Maximum 100 UUIDs generated per request');
  }

  return lines.join('\n');
}

function formatOutput(
  operation: string,
  input: string,
  output: string,
  meta?: Record<string, string>
): string {
  const lines: string[] = [];
  lines.push(`=== ${operation} ===`);
  lines.push(`Input: "${input.substring(0, 100)}${input.length > 100 ? '...' : ''}"`);
  lines.push(`Input Length: ${input.length}`);

  if (meta) {
    for (const [key, value] of Object.entries(meta)) {
      lines.push(`${key}: ${value}`);
    }
  }

  lines.push('');
  lines.push(`Output: ${output}`);
  lines.push(`Output Length: ${output.length}`);

  return lines.join('\n');
}
