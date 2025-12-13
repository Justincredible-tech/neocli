/* NEO_SKILL_META
{
  "name": "html_processor",
  "description": "Manipulates HTML files using DOM selectors (jQuery/Cheerio syntax).",
  "argsSchema": {
    "type": "object",
    "properties": {
      "filePath": { "type": "string", "description": "Path to HTML file" },
      "selector": { "type": "string", "description": "CSS Selector to target (e.g. 'body', '.footer', '#login-btn')" },
      "action": { "type": "string", "enum": ["get", "set", "append", "remove"], "description": "What to do with the element" },
      "content": { "type": "string", "description": "HTML content to set/append (optional)" }
    },
    "required": ["filePath", "selector", "action"]
  }
}
NEO_SKILL_META */

import fs from 'fs';
import path from 'path';
import * as cheerio from 'cheerio';

export async function run(args: { filePath: string; selector: string; action: 'get'|'set'|'append'|'remove'; content?: string }) {
  const { filePath, selector, action, content } = args;
  
  const absPath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absPath)) return `Error: File not found at ${absPath}`;

  try {
    // 1. Load HTML
    const html = fs.readFileSync(absPath, 'utf-8');
    const $ = cheerio.load(html);
    const target = $(selector);

    if (target.length === 0) return `Warning: Selector "${selector}" found no elements.`;

    // 2. Perform Surgery
    let resultMsg = "";

    switch (action) {
      case 'get':
        return `Content of '${selector}':\n${target.html()}`;
      
      case 'remove':
        target.remove();
        resultMsg = `Removed element(s) matching "${selector}"`;
        break;

      case 'set':
        if (content === undefined) return "Error: 'content' is required for set action.";
        target.html(content);
        resultMsg = `Replaced content of "${selector}"`;
        break;

      case 'append':
        if (content === undefined) return "Error: 'content' is required for append action.";
        target.append(content);
        resultMsg = `Appended content to "${selector}"`;
        break;
    }

    // 3. Save (if modified)
    if (action !== 'get') {
      fs.writeFileSync(absPath, $.html(), 'utf-8');
    }

    return `Success: ${resultMsg}`;

  } catch (e: any) {
    return `Surgeon Error: ${e.message}`;
  }
}