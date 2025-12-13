/* NEO_SKILL_META
{
  "name": "api_client",
  "description": "Generic API Client with SSRF protection. Injects Bearer tokens from env vars if specified.",
  "argsSchema": {
    "type": "object",
    "properties": {
      "method": { "type": "string", "enum": ["GET", "POST", "PUT", "DELETE", "PATCH"], "default": "GET" },
      "url": { "type": "string", "description": "The API endpoint URL (http/https only)" },
      "envTokenVar": { "type": "string", "description": "Name of ENV var containing the Bearer token (e.g. 'AZURE_TOKEN')" },
      "body": { "type": "object", "description": "JSON payload for POST/PUT/PATCH" },
      "headers": { "type": "object", "description": "Additional headers to include" },
      "timeout": { "type": "number", "description": "Request timeout in milliseconds (default: 30000)" }
    },
    "required": ["url"]
  }
}
NEO_SKILL_META */

interface ApiClientArgs {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  url: string;
  envTokenVar?: string;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
  timeout?: number;
}

/**
 * Validates a URL for safety (SSRF protection).
 * @param url - The URL to validate
 * @returns Validated URL string
 * @throws Error if URL is dangerous
 */
function validateUrl(url: string): string {
  if (!url || typeof url !== 'string') {
    throw new Error("URL is required and must be a string.");
  }

  const trimmedUrl = url.trim();

  try {
    const parsed = new URL(trimmedUrl);

    // Only allow http and https protocols
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error(`Protocol '${parsed.protocol}' not allowed. Use http or https.`);
    }

    // Block localhost and loopback addresses
    const hostname = parsed.hostname.toLowerCase();
    const blockedHosts = [
      'localhost',
      '127.0.0.1',
      '0.0.0.0',
      '::1',
      '[::1]'
    ];

    if (blockedHosts.includes(hostname)) {
      throw new Error("Access to localhost is not allowed for security reasons.");
    }

    // Block internal IP ranges (SSRF prevention)
    const internalRanges = [
      /^10\./,                           // 10.0.0.0/8
      /^172\.(1[6-9]|2[0-9]|3[01])\./,  // 172.16.0.0/12
      /^192\.168\./,                     // 192.168.0.0/16
      /^169\.254\./,                     // Link-local
      /^fc00:/i,                         // IPv6 private
      /^fd[0-9a-f]{2}:/i,               // IPv6 private
      /^fe80:/i,                         // IPv6 link-local
    ];

    for (const range of internalRanges) {
      if (range.test(hostname)) {
        throw new Error("Access to internal IP ranges is not allowed for security reasons.");
      }
    }

    // Block common cloud metadata endpoints
    const blockedPaths = [
      '/latest/meta-data',  // AWS metadata
      '/metadata',          // GCP metadata
      '/computeMetadata',   // GCP metadata
    ];

    for (const blockedPath of blockedPaths) {
      if (parsed.pathname.toLowerCase().includes(blockedPath.toLowerCase())) {
        throw new Error("Access to cloud metadata endpoints is not allowed.");
      }
    }

    return trimmedUrl;

  } catch (e) {
    if (e instanceof Error && e.message.includes('not allowed')) {
      throw e;
    }
    throw new Error(`Invalid URL format: ${(e as Error).message}`);
  }
}

/**
 * Validates environment variable name for safety.
 * @param varName - The environment variable name
 * @returns True if valid
 */
function validateEnvVarName(varName: string): boolean {
  if (!varName || typeof varName !== 'string') {
    return false;
  }
  // Only allow alphanumeric and underscore, must start with letter or underscore
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(varName);
}

export async function run(args: ApiClientArgs): Promise<string> {
  const {
    method = 'GET',
    url,
    envTokenVar,
    body,
    headers: customHeaders = {},
    timeout = 30000
  } = args;

  try {
    // 1. Validate URL for security
    const validatedUrl = validateUrl(url);

    // 2. Build headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'NeoCLI/2.3.0 (API Client)',
      ...customHeaders
    };

    // 3. Add authorization if env var specified
    if (envTokenVar) {
      if (!validateEnvVarName(envTokenVar)) {
        return `Error: Invalid environment variable name '${envTokenVar}'.`;
      }

      const token = process.env[envTokenVar];
      if (!token) {
        return `Error: Environment variable '${envTokenVar}' is not set or empty.`;
      }

      // Don't expose the actual token in logs
      headers['Authorization'] = `Bearer ${token}`;
    }

    // 4. Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    // 5. Make the request
    const fetchOptions: RequestInit = {
      method: method.toUpperCase(),
      headers,
      signal: controller.signal
    };

    // Add body for methods that support it
    if (['POST', 'PUT', 'PATCH'].includes(method.toUpperCase()) && body) {
      fetchOptions.body = JSON.stringify(body);
    }

    const res = await fetch(validatedUrl, fetchOptions);

    clearTimeout(timeoutId);

    // 6. Get response
    const responseText = await res.text();

    // 7. Build result
    let result = `API Response [${res.status} ${res.statusText}]\n`;
    result += `URL: ${validatedUrl}\n`;
    result += `Method: ${method.toUpperCase()}\n`;
    result += '─'.repeat(40) + '\n\n';

    // Try to parse and format JSON
    try {
      const json = JSON.parse(responseText);
      result += JSON.stringify(json, null, 2);
    } catch {
      // Return raw text if not JSON
      result += responseText;
    }

    // Truncate if too long
    const maxLength = 10000;
    if (result.length > maxLength) {
      result = result.substring(0, maxLength) + `\n\n...[Truncated - ${result.length - maxLength} chars omitted]`;
    }

    return result;

  } catch (e: unknown) {
    const error = e as Error;

    if (error.name === 'AbortError') {
      return `Error: Request timed out after ${timeout}ms`;
    }

    return `API Request Failed: ${error.message}`;
  }
}
