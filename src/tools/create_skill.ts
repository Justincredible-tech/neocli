// src/tools/create_skill.ts
/**
 * Create Skill Tool
 * Creates a new permanent skill in the .neo/skills directory.
 */
import { Tool, ToolArgs } from '../types/index.js';
import * as fs from 'fs';
import * as path from 'path';

interface CreateSkillArgs extends ToolArgs {
  name: string;
  description: string;
  code: string;
  argsSchema?: Record<string, unknown>;
}

const tool: Tool = {
  name: 'create_skill',
  description: 'Create a new, permanent skill. Use this when you have written logic that should be reused. You must provide the code, a name, and a description.',
  source: 'CORE',
  execute: async (args: ToolArgs): Promise<string> => {
    const { name, description, code, argsSchema } = args as CreateSkillArgs;

    try {
      // 1. Input Validation
      if (!name || !code || !description) {
        return "ERROR: Missing required fields (name, description, or code).";
      }

      // 2. Sanitize Name
      const cleanName = name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
      const filename = `${cleanName}.ts`;
      const skillsDir = path.join(process.cwd(), '.neo', 'skills');

      // 3. Ensure Directory Exists
      if (!fs.existsSync(skillsDir)) {
        fs.mkdirSync(skillsDir, { recursive: true });
      }

      // 4. Validate Code Structure (Heuristic)
      if (!code.includes('export async function run')) {
        return "ERROR: The code must export an async function named 'run'. Example: `export async function run(args: any): Promise<string> { ... }`";
      }

      // 5. Construct Metadata Block
      // We default the schema to "any" if not provided, but encouraging specific schemas is better.
      const meta = {
        name: cleanName,
        description: description,
        argsSchema: argsSchema || { type: "object", properties: {} }
      };

      const fileContent = `/* NEO_SKILL_META
${JSON.stringify(meta, null, 2)}
NEO_SKILL_META */

${code}
`;

      // 6. Write to Disk
      const filePath = path.join(skillsDir, filename);
      fs.writeFileSync(filePath, fileContent);

      return `SUCCESS: Skill '${cleanName}' has been saved to ${filePath}. \n[SYSTEM]: The Agent capabilities have been updated. You can now use this skill in future turns.`;

    } catch (e: any) {
      return `ERROR creating skill: ${e.message}`;
    }
  }
};

export default tool;