/* NEO_SKILL_META
{
  "name": "json_schema_validator",
  "description": "Validates JSON against JSON Schema, generates schemas from sample JSON, and compares schema differences. Supports JSON Schema draft-07.",
  "argsSchema": {
    "type": "object",
    "properties": {
      "action": {
        "type": "string",
        "enum": ["validate", "generate", "diff"],
        "description": "Action to perform"
      },
      "json": { "type": "string", "description": "JSON string or file path to validate/analyze" },
      "schema": { "type": "string", "description": "JSON Schema string or file path" },
      "schemaB": { "type": "string", "description": "Second schema for diff comparison" },
      "options": {
        "type": "object",
        "properties": {
          "allErrors": { "type": "boolean", "description": "Report all errors, not just first (default: true)" },
          "strict": { "type": "boolean", "description": "Strict schema generation (default: false)" },
          "required": { "type": "boolean", "description": "Mark all fields as required in generated schema (default: false)" }
        }
      }
    },
    "required": ["action"]
  }
}
NEO_SKILL_META */

import fs from 'fs';
import path from 'path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

interface ValidatorArgs {
  action: 'validate' | 'generate' | 'diff';
  json?: string;
  schema?: string;
  schemaB?: string;
  options?: {
    allErrors?: boolean;
    strict?: boolean;
    required?: boolean;
  };
}

export async function run(args: ValidatorArgs): Promise<string> {
  const { action, json, schema, schemaB, options = {} } = args;

  if (!action) {
    return 'Error: action is required (validate, generate, diff)';
  }

  switch (action) {
    case 'validate':
      return validateJson(json, schema, options);
    case 'generate':
      return generateSchema(json, options);
    case 'diff':
      return diffSchemas(schema, schemaB);
    default:
      return `Error: Unknown action "${action}"`;
  }
}

function loadJsonOrParse(input: string | undefined, label: string): { data: unknown; error?: string } {
  if (!input) {
    return { data: null, error: `${label} is required` };
  }

  // Check if it's a file path
  if (!input.trim().startsWith('{') && !input.trim().startsWith('[')) {
    const absPath = path.resolve(process.cwd(), input);
    if (fs.existsSync(absPath)) {
      try {
        const content = fs.readFileSync(absPath, 'utf-8');
        return { data: JSON.parse(content) };
      } catch (e: unknown) {
        return { data: null, error: `Failed to parse ${label} file: ${(e as Error).message}` };
      }
    }
  }

  // Try to parse as JSON string
  try {
    return { data: JSON.parse(input) };
  } catch (e: unknown) {
    return { data: null, error: `Failed to parse ${label}: ${(e as Error).message}` };
  }
}

function validateJson(json: string | undefined, schema: string | undefined, options: ValidatorArgs['options']): string {
  const { allErrors = true } = options || {};

  const jsonResult = loadJsonOrParse(json, 'json');
  if (jsonResult.error) return `Error: ${jsonResult.error}`;

  const schemaResult = loadJsonOrParse(schema, 'schema');
  if (schemaResult.error) return `Error: ${schemaResult.error}`;

  try {
    const ajv = new Ajv({ allErrors, verbose: true });
    addFormats(ajv);

    const validate = ajv.compile(schemaResult.data as object);
    const valid = validate(jsonResult.data);

    const lines: string[] = [];
    lines.push('=== JSON Schema Validation ===');
    lines.push(`Result: ${valid ? 'VALID' : 'INVALID'}`);
    lines.push('');

    if (!valid && validate.errors) {
      lines.push(`Found ${validate.errors.length} error(s):`);
      lines.push('');

      for (const error of validate.errors) {
        const instancePath = error.instancePath || '(root)';
        lines.push(`  Path: ${instancePath}`);
        lines.push(`  Error: ${error.message}`);
        if (error.params) {
          lines.push(`  Details: ${JSON.stringify(error.params)}`);
        }
        lines.push('');
      }
    } else if (valid) {
      lines.push('JSON is valid against the schema.');
    }

    return lines.join('\n');

  } catch (e: unknown) {
    return `Error validating: ${(e as Error).message}`;
  }
}

function generateSchema(json: string | undefined, options: ValidatorArgs['options']): string {
  const { strict = false, required: markRequired = false } = options || {};

  const jsonResult = loadJsonOrParse(json, 'json');
  if (jsonResult.error) return `Error: ${jsonResult.error}`;

  try {
    const schema = inferSchema(jsonResult.data, { strict, markRequired });

    const lines: string[] = [];
    lines.push('=== Generated JSON Schema ===');
    lines.push('');
    lines.push(JSON.stringify(schema, null, 2));
    lines.push('');
    lines.push('Note: Generated schema is a starting point. Review and adjust as needed.');

    return lines.join('\n');

  } catch (e: unknown) {
    return `Error generating schema: ${(e as Error).message}`;
  }
}

function inferSchema(data: unknown, options: { strict: boolean; markRequired: boolean }, depth: number = 0): object {
  if (depth > 20) {
    return { type: 'object', description: 'Max depth reached' };
  }

  if (data === null) {
    return { type: 'null' };
  }

  if (Array.isArray(data)) {
    if (data.length === 0) {
      return { type: 'array', items: {} };
    }

    // Check if all items have same type
    const itemSchemas = data.slice(0, 10).map(item => inferSchema(item, options, depth + 1));

    // Try to merge schemas if they're similar
    if (itemSchemas.length > 0) {
      const firstType = (itemSchemas[0] as { type?: string }).type;
      const allSameType = itemSchemas.every(s => (s as { type?: string }).type === firstType);

      if (allSameType && firstType === 'object') {
        // Merge object schemas
        const mergedSchema = mergeObjectSchemas(itemSchemas as { properties?: Record<string, object> }[]);
        return { type: 'array', items: mergedSchema };
      }

      return { type: 'array', items: itemSchemas[0] };
    }

    return { type: 'array', items: {} };
  }

  if (typeof data === 'object') {
    const properties: Record<string, object> = {};
    const requiredFields: string[] = [];

    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      properties[key] = inferSchema(value, options, depth + 1);
      if (options.markRequired) {
        requiredFields.push(key);
      }
    }

    const schema: Record<string, unknown> = {
      type: 'object',
      properties
    };

    if (requiredFields.length > 0) {
      schema.required = requiredFields;
    }

    if (options.strict) {
      schema.additionalProperties = false;
    }

    return schema;
  }

  if (typeof data === 'string') {
    const schema: Record<string, unknown> = { type: 'string' };

    // Try to detect format
    if (/^\d{4}-\d{2}-\d{2}$/.test(data)) {
      schema.format = 'date';
    } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(data)) {
      schema.format = 'date-time';
    } else if (/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(data)) {
      schema.format = 'email';
    } else if (/^https?:\/\//.test(data)) {
      schema.format = 'uri';
    } else if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(data)) {
      schema.format = 'uuid';
    }

    if (options.strict && data.length > 0) {
      schema.minLength = 1;
    }

    return schema;
  }

  if (typeof data === 'number') {
    if (Number.isInteger(data)) {
      return { type: 'integer' };
    }
    return { type: 'number' };
  }

  if (typeof data === 'boolean') {
    return { type: 'boolean' };
  }

  return {};
}

function mergeObjectSchemas(schemas: { properties?: Record<string, object> }[]): object {
  const mergedProperties: Record<string, object> = {};

  for (const schema of schemas) {
    if (schema.properties) {
      for (const [key, value] of Object.entries(schema.properties)) {
        if (!mergedProperties[key]) {
          mergedProperties[key] = value;
        }
        // Could add more sophisticated merging here
      }
    }
  }

  return {
    type: 'object',
    properties: mergedProperties
  };
}

function diffSchemas(schemaA: string | undefined, schemaB: string | undefined): string {
  const resultA = loadJsonOrParse(schemaA, 'schema');
  if (resultA.error) return `Error: ${resultA.error}`;

  const resultB = loadJsonOrParse(schemaB, 'schemaB');
  if (resultB.error) return `Error: ${resultB.error}`;

  const lines: string[] = [];
  lines.push('=== Schema Comparison ===');
  lines.push('');

  const differences = compareObjects(
    resultA.data as Record<string, unknown>,
    resultB.data as Record<string, unknown>,
    ''
  );

  if (differences.length === 0) {
    lines.push('Schemas are identical.');
  } else {
    lines.push(`Found ${differences.length} difference(s):`);
    lines.push('');

    for (const diff of differences) {
      lines.push(`  ${diff.type.toUpperCase()}: ${diff.path}`);
      if (diff.valueA !== undefined) {
        lines.push(`    Schema A: ${JSON.stringify(diff.valueA)}`);
      }
      if (diff.valueB !== undefined) {
        lines.push(`    Schema B: ${JSON.stringify(diff.valueB)}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

interface SchemaDiff {
  type: 'added' | 'removed' | 'changed';
  path: string;
  valueA?: unknown;
  valueB?: unknown;
}

function compareObjects(a: unknown, b: unknown, path: string): SchemaDiff[] {
  const diffs: SchemaDiff[] = [];

  if (typeof a !== typeof b) {
    diffs.push({ type: 'changed', path: path || '(root)', valueA: a, valueB: b });
    return diffs;
  }

  if (a === null || b === null) {
    if (a !== b) {
      diffs.push({ type: 'changed', path: path || '(root)', valueA: a, valueB: b });
    }
    return diffs;
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    const maxLen = Math.max(a.length, b.length);
    for (let i = 0; i < maxLen; i++) {
      const itemPath = `${path}[${i}]`;
      if (i >= a.length) {
        diffs.push({ type: 'added', path: itemPath, valueB: b[i] });
      } else if (i >= b.length) {
        diffs.push({ type: 'removed', path: itemPath, valueA: a[i] });
      } else {
        diffs.push(...compareObjects(a[i], b[i], itemPath));
      }
    }
    return diffs;
  }

  if (typeof a === 'object' && typeof b === 'object') {
    const objA = a as Record<string, unknown>;
    const objB = b as Record<string, unknown>;
    const keysA = new Set(Object.keys(objA));
    const keysB = new Set(Object.keys(objB));

    // Check for removed keys
    for (const key of keysA) {
      const keyPath = path ? `${path}.${key}` : key;
      if (!keysB.has(key)) {
        diffs.push({ type: 'removed', path: keyPath, valueA: objA[key] });
      } else {
        diffs.push(...compareObjects(objA[key], objB[key], keyPath));
      }
    }

    // Check for added keys
    for (const key of keysB) {
      if (!keysA.has(key)) {
        const keyPath = path ? `${path}.${key}` : key;
        diffs.push({ type: 'added', path: keyPath, valueB: objB[key] });
      }
    }

    return diffs;
  }

  // Primitive comparison
  if (a !== b) {
    diffs.push({ type: 'changed', path: path || '(root)', valueA: a, valueB: b });
  }

  return diffs;
}
