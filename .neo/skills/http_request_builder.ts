/* NEO_SKILL_META
{
  "name": "http_request_builder",
  "description": "Build and execute HTTP requests with support for all methods, headers, body types, authentication, and response validation.",
  "argsSchema": {
    "type": "object",
    "properties": {
      "action": {
        "type": "string",
        "enum": ["request", "template", "validate"],
        "description": "Action to perform"
      },
      "method": { "type": "string", "enum": ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"], "description": "HTTP method" },
      "url": { "type": "string", "description": "Request URL" },
      "options": {
        "type": "object",
        "properties": {
          "headers": { "type": "object", "description": "Request headers" },
          "body": { "type": "string", "description": "Request body (JSON string)" },
          "auth": {
            "type": "object",
            "properties": {
              "type": { "type": "string", "enum": ["bearer", "basic", "apikey"] },
              "token": { "type": "string" },
              "username": { "type": "string" },
              "password": { "type": "string" },
              "key": { "type": "string" },
              "headerName": { "type": "string" }
            }
          },
          "timeout": { "type": "number", "description": "Timeout in milliseconds (default: 30000)" },
          "followRedirects": { "type": "boolean", "description": "Follow redirects (default: true)" },
          "validateStatus": { "type": "array", "items": { "type": "number" }, "description": "Valid status codes" },
          "saveTo": { "type": "string", "description": "Save response to file" }
        }
      }
    },
    "required": ["action"]
  }
}
NEO_SKILL_META */

import fs from 'fs';
import path from 'path';

interface HttpArgs {
  action: 'request' | 'template' | 'validate';
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
  url?: string;
  options?: {
    headers?: Record<string, string>;
    body?: string;
    auth?: {
      type: 'bearer' | 'basic' | 'apikey';
      token?: string;
      username?: string;
      password?: string;
      key?: string;
      headerName?: string;
    };
    timeout?: number;
    followRedirects?: boolean;
    validateStatus?: number[];
    saveTo?: string;
  };
}

interface HttpResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  time: number;
}

export async function run(args: HttpArgs): Promise<string> {
  const { action, method = 'GET', url, options = {} } = args;

  if (!action) {
    return 'Error: action is required';
  }

  try {
    switch (action) {
      case 'request':
        return executeRequest(method, url, options);
      case 'template':
        return generateTemplate(method, url, options);
      case 'validate':
        return validateRequest(method, url, options);
      default:
        return `Error: Unknown action "${action}"`;
    }
  } catch (e: unknown) {
    return `Error: ${(e as Error).message}`;
  }
}

async function executeRequest(
  method: string,
  url: string | undefined,
  options: HttpArgs['options']
): Promise<string> {
  if (!url) {
    return 'Error: url is required for request action';
  }

  // Validate URL
  try {
    new URL(url);
  } catch {
    return `Error: Invalid URL: ${url}`;
  }

  const {
    headers = {},
    body,
    auth,
    timeout = 30000,
    followRedirects = true,
    validateStatus,
    saveTo
  } = options || {};

  // Build headers
  const requestHeaders: Record<string, string> = { ...headers };

  // Add auth
  if (auth) {
    switch (auth.type) {
      case 'bearer':
        if (!auth.token) return 'Error: token required for bearer auth';
        requestHeaders['Authorization'] = `Bearer ${auth.token}`;
        break;
      case 'basic':
        if (!auth.username || !auth.password) return 'Error: username and password required for basic auth';
        const credentials = Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
        requestHeaders['Authorization'] = `Basic ${credentials}`;
        break;
      case 'apikey':
        if (!auth.key) return 'Error: key required for apikey auth';
        const headerName = auth.headerName || 'X-API-Key';
        requestHeaders[headerName] = auth.key;
        break;
    }
  }

  // Set content-type if body present
  if (body && !requestHeaders['Content-Type']) {
    requestHeaders['Content-Type'] = 'application/json';
  }

  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const fetchOptions: RequestInit = {
      method,
      headers: requestHeaders,
      signal: controller.signal,
      redirect: followRedirects ? 'follow' : 'manual'
    };

    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      fetchOptions.body = body;
    }

    const response = await fetch(url, fetchOptions);
    clearTimeout(timeoutId);

    const endTime = Date.now();
    const responseTime = endTime - startTime;

    // Get response body
    let responseBody: string;
    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      const json = await response.json();
      responseBody = JSON.stringify(json, null, 2);
    } else {
      responseBody = await response.text();
    }

    // Validate status if configured
    if (validateStatus && !validateStatus.includes(response.status)) {
      return `Error: Status ${response.status} not in valid list [${validateStatus.join(', ')}]\n\nResponse:\n${responseBody.substring(0, 500)}`;
    }

    // Save to file if requested
    if (saveTo) {
      const absPath = path.resolve(process.cwd(), saveTo);
      fs.writeFileSync(absPath, responseBody, 'utf-8');
    }

    // Format output
    const output: string[] = [];
    output.push('=== HTTP Response ===');
    output.push('');
    output.push(`${method} ${url}`);
    output.push(`Status: ${response.status} ${response.statusText}`);
    output.push(`Time: ${responseTime}ms`);
    output.push('');

    output.push('Response Headers:');
    response.headers.forEach((value, key) => {
      output.push(`  ${key}: ${value}`);
    });
    output.push('');

    output.push('Response Body:');
    if (responseBody.length > 2000) {
      output.push(responseBody.substring(0, 2000));
      output.push(`\n... (truncated, ${responseBody.length - 2000} more chars)`);
    } else {
      output.push(responseBody);
    }

    if (saveTo) {
      output.push('');
      output.push(`Response saved to: ${saveTo}`);
    }

    return output.join('\n');

  } catch (e: unknown) {
    const error = e as Error;
    if (error.name === 'AbortError') {
      return `Error: Request timed out after ${timeout}ms`;
    }
    throw e;
  }
}

function generateTemplate(
  method: string,
  url: string | undefined,
  options: HttpArgs['options']
): string {
  const { headers = {}, body, auth } = options || {};

  const output: string[] = [];
  output.push('=== Request Template ===');
  output.push('');

  // cURL command
  output.push('cURL:');
  output.push('```bash');
  let curl = `curl -X ${method}`;

  if (auth) {
    switch (auth.type) {
      case 'bearer':
        curl += ` \\\n  -H "Authorization: Bearer ${auth.token || 'YOUR_TOKEN'}"`;
        break;
      case 'basic':
        curl += ` \\\n  -u "${auth.username || 'user'}:${auth.password || 'pass'}"`;
        break;
      case 'apikey':
        curl += ` \\\n  -H "${auth.headerName || 'X-API-Key'}: ${auth.key || 'YOUR_KEY'}"`;
        break;
    }
  }

  for (const [key, value] of Object.entries(headers)) {
    curl += ` \\\n  -H "${key}: ${value}"`;
  }

  if (body) {
    curl += ` \\\n  -H "Content-Type: application/json"`;
    curl += ` \\\n  -d '${body}'`;
  }

  curl += ` \\\n  "${url || 'https://api.example.com/endpoint'}"`;
  output.push(curl);
  output.push('```');
  output.push('');

  // Fetch (JavaScript)
  output.push('JavaScript (fetch):');
  output.push('```javascript');
  output.push('const response = await fetch(');
  output.push(`  "${url || 'https://api.example.com/endpoint'}",`);
  output.push('  {');
  output.push(`    method: "${method}",`);
  output.push('    headers: {');

  if (auth?.type === 'bearer') {
    output.push(`      "Authorization": "Bearer ${auth.token || 'YOUR_TOKEN'}",`);
  }
  if (auth?.type === 'apikey') {
    output.push(`      "${auth.headerName || 'X-API-Key'}": "${auth.key || 'YOUR_KEY'}",`);
  }
  for (const [key, value] of Object.entries(headers)) {
    output.push(`      "${key}": "${value}",`);
  }
  if (body) {
    output.push('      "Content-Type": "application/json",');
  }

  output.push('    },');

  if (body) {
    output.push(`    body: JSON.stringify(${body}),`);
  }

  output.push('  }');
  output.push(');');
  output.push('const data = await response.json();');
  output.push('```');
  output.push('');

  // Python (requests)
  output.push('Python (requests):');
  output.push('```python');
  output.push('import requests');
  output.push('');
  output.push('response = requests.request(');
  output.push(`    "${method}",`);
  output.push(`    "${url || 'https://api.example.com/endpoint'}",`);
  output.push('    headers={');

  if (auth?.type === 'bearer') {
    output.push(`        "Authorization": "Bearer ${auth.token || 'YOUR_TOKEN'}",`);
  }
  if (auth?.type === 'apikey') {
    output.push(`        "${auth.headerName || 'X-API-Key'}": "${auth.key || 'YOUR_KEY'}",`);
  }
  for (const [key, value] of Object.entries(headers)) {
    output.push(`        "${key}": "${value}",`);
  }

  output.push('    },');

  if (body) {
    output.push(`    json=${body},`);
  }

  output.push(')');
  output.push('data = response.json()');
  output.push('```');

  return output.join('\n');
}

function validateRequest(
  method: string,
  url: string | undefined,
  options: HttpArgs['options']
): string {
  const { headers = {}, body, auth } = options || {};
  const issues: string[] = [];
  const warnings: string[] = [];

  // Validate URL
  if (!url) {
    issues.push('URL is required');
  } else {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        issues.push(`Invalid protocol: ${parsed.protocol}`);
      }
      if (parsed.protocol === 'http:') {
        warnings.push('Using HTTP instead of HTTPS - consider using HTTPS');
      }
    } catch {
      issues.push(`Invalid URL format: ${url}`);
    }
  }

  // Validate method
  const validMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
  if (!validMethods.includes(method)) {
    issues.push(`Invalid HTTP method: ${method}`);
  }

  // Validate body
  if (body) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      warnings.push(`Body is typically not used with ${method} requests`);
    }

    try {
      JSON.parse(body);
    } catch {
      warnings.push('Body is not valid JSON');
    }
  }

  // Validate auth
  if (auth) {
    switch (auth.type) {
      case 'bearer':
        if (!auth.token) issues.push('Bearer auth requires token');
        break;
      case 'basic':
        if (!auth.username) issues.push('Basic auth requires username');
        if (!auth.password) issues.push('Basic auth requires password');
        break;
      case 'apikey':
        if (!auth.key) issues.push('API Key auth requires key');
        break;
    }
  }

  // Check for common header issues
  if (headers['content-type'] && !body) {
    warnings.push('Content-Type header set but no body provided');
  }

  // Build output
  const output: string[] = [];
  output.push('=== Request Validation ===');
  output.push('');
  output.push(`Method: ${method}`);
  output.push(`URL: ${url || '(not set)'}`);
  output.push(`Headers: ${Object.keys(headers).length}`);
  output.push(`Body: ${body ? 'Yes' : 'No'}`);
  output.push(`Auth: ${auth ? auth.type : 'None'}`);
  output.push('');

  if (issues.length === 0 && warnings.length === 0) {
    output.push('✓ Request is valid');
    return output.join('\n');
  }

  if (issues.length > 0) {
    output.push(`Errors (${issues.length}):`);
    for (const issue of issues) {
      output.push(`  ✗ ${issue}`);
    }
    output.push('');
  }

  if (warnings.length > 0) {
    output.push(`Warnings (${warnings.length}):`);
    for (const warning of warnings) {
      output.push(`  ! ${warning}`);
    }
    output.push('');
  }

  output.push(issues.length > 0 ? '✗ Request has errors' : '✓ Request is valid (with warnings)');

  return output.join('\n');
}
