/* NEO_SKILL_META
{
  "name": "json_transmuter",
  "description": "Maps a source JSON file to a new structure using a mapping schema.",
  "argsSchema": {
    "type": "object",
    "properties": {
      "inputPath": { "type": "string", "description": "Path to source JSON" },
      "mapping": { "type": "object", "description": "Key-Value pairs where Value is a JSONPath string (e.g. '$.user.id')" },
      "outputPath": { "type": "string", "description": "Where to save the result" }
    },
    "required": ["inputPath", "mapping", "outputPath"]
  }
}
NEO_SKILL_META */

import fs from 'fs';
import path from 'path';
import jp from 'jsonpath';

export async function run(args: { inputPath: string; mapping: Record<string, string>; outputPath: string }) {
  const { inputPath, mapping, outputPath } = args;
  
  const absInput = path.resolve(process.cwd(), inputPath);
  if (!fs.existsSync(absInput)) return `Error: Input file ${absInput} not found.`;

  try {
    const sourceData = JSON.parse(fs.readFileSync(absInput, 'utf-8'));
    const result: Record<string, any> = {};

    // Execute Mapping
    for (const [targetKey, jsonPath] of Object.entries(mapping)) {
      // jsonpath returns an array of matches. We usually want the first one.
      const queryResult = jp.query(sourceData, jsonPath);
      result[targetKey] = queryResult.length > 0 ? queryResult[0] : null;
    }

    fs.writeFileSync(path.resolve(process.cwd(), outputPath), JSON.stringify(result, null, 2));
    return `Success: Transmuted data saved to ${outputPath}`;

  } catch (e: any) {
    return `Transmutation Error: ${e.message}`;
  }
}