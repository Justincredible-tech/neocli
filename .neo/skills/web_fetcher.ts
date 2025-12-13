/* NEO_SKILL_META
{
  "name": "web_fetcher",
  "description": "Fetches a URL and converts the content to Markdown for reading. Includes SSRF protection.",
  "argsSchema": {
    "type": "object",
    "properties": {
      "url": { "type": "string", "description": "The URL to fetch (http/https only)" },
      "maxLength": { "type": "number", "description": "Maximum content length to return (default: 8000)" },
      "timeout": { "type": "number", "description": "Request timeout in milliseconds (default: 30000)" }
    },
    "required": ["url"]
  }
}
NEO_SKILL_META */

import TurndownService from 'turndown';

interface WebFetcherArgs {
  url: string;
  maxLength?: number;
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

    // Block common metadata endpoints
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

export async function run(args: WebFetcherArgs): Promise<string> {
  const { url, maxLength = 8000, timeout = 30000 } = args;

  try {
    // 1. Validate URL for security
    const validatedUrl = validateUrl(url);

    // 2. Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    // 3. Fetch the URL
    const res = await fetch(validatedUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'NeoCLI/2.3.0 (Web Fetcher)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    // 4. Check content type
    const contentType = res.headers.get('content-type') || '';

    // 5. Get content
    const text = await res.text();

    // 6. Convert to markdown if HTML
    let content: string;
    if (contentType.includes('text/html') || contentType.includes('application/xhtml')) {
      const turndownService = new TurndownService({
        headingStyle: 'atx',
        codeBlockStyle: 'fenced'
      });

      // Remove script, style, and other non-content elements
      turndownService.remove(['script', 'style', 'iframe', 'noscript', 'nav', 'footer', 'header']);

      content = turndownService.turndown(text);
    } else {
      // Return raw text for non-HTML content
      content = text;
    }

    // 7. Truncate if too long
    if (content.length > maxLength) {
      content = content.substring(0, maxLength) + `\n\n...[Truncated - ${content.length - maxLength} chars omitted]`;
    }

    // 8. Add metadata header
    const header = `Source: ${validatedUrl}\nFetched: ${new Date().toISOString()}\n${'─'.repeat(40)}\n\n`;

    return header + content;

  } catch (e: unknown) {
    const error = e as Error;

    if (error.name === 'AbortError') {
      return `Error: Request timed out after ${timeout}ms`;
    }

    return `Error fetching URL: ${error.message}`;
  }
}
