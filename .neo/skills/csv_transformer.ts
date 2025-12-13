/* NEO_SKILL_META
{
  "name": "csv_transformer",
  "description": "Parses a CSV and applies safe predefined transformations (filter, map, sort, select_columns, aggregate). No arbitrary code execution.",
  "argsSchema": {
    "type": "object",
    "properties": {
      "inputPath": { "type": "string", "description": "Path to source CSV" },
      "outputPath": { "type": "string", "description": "Path to save result" },
      "operation": {
        "type": "string",
        "enum": ["filter", "map", "sort", "select_columns", "aggregate", "deduplicate"],
        "description": "Type of transformation to apply"
      },
      "config": {
        "type": "object",
        "description": "Operation-specific configuration",
        "properties": {
          "field": { "type": "string", "description": "Field name to operate on" },
          "operator": { "type": "string", "description": "Comparison operator (eq, ne, gt, lt, gte, lte, contains, startsWith, endsWith)" },
          "value": { "type": "string", "description": "Value to compare against" },
          "columns": { "type": "array", "items": { "type": "string" }, "description": "Columns to select or group by" },
          "direction": { "type": "string", "enum": ["asc", "desc"], "description": "Sort direction" },
          "transforms": { "type": "object", "description": "Field transformations for map operation" },
          "aggregateField": { "type": "string", "description": "Field to aggregate" },
          "aggregateFunc": { "type": "string", "enum": ["count", "sum", "avg", "min", "max"], "description": "Aggregation function" }
        }
      }
    },
    "required": ["inputPath", "outputPath", "operation", "config"]
  }
}
NEO_SKILL_META */

import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

interface TransformConfig {
  field?: string;
  operator?: 'eq' | 'ne' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains' | 'startsWith' | 'endsWith';
  value?: string | number;
  columns?: string[];
  direction?: 'asc' | 'desc';
  transforms?: Record<string, { operation: string; value?: string | number }>;
  aggregateField?: string;
  aggregateFunc?: 'count' | 'sum' | 'avg' | 'min' | 'max';
}

type Row = Record<string, unknown>;

// Safe comparison function
function compare(rowValue: unknown, operator: string, compareValue: unknown): boolean {
  const strRowValue = String(rowValue ?? '');
  const strCompareValue = String(compareValue ?? '');
  const numRowValue = parseFloat(strRowValue);
  const numCompareValue = parseFloat(strCompareValue);

  switch (operator) {
    case 'eq': return strRowValue === strCompareValue;
    case 'ne': return strRowValue !== strCompareValue;
    case 'gt': return !isNaN(numRowValue) && !isNaN(numCompareValue) && numRowValue > numCompareValue;
    case 'lt': return !isNaN(numRowValue) && !isNaN(numCompareValue) && numRowValue < numCompareValue;
    case 'gte': return !isNaN(numRowValue) && !isNaN(numCompareValue) && numRowValue >= numCompareValue;
    case 'lte': return !isNaN(numRowValue) && !isNaN(numCompareValue) && numRowValue <= numCompareValue;
    case 'contains': return strRowValue.toLowerCase().includes(strCompareValue.toLowerCase());
    case 'startsWith': return strRowValue.toLowerCase().startsWith(strCompareValue.toLowerCase());
    case 'endsWith': return strRowValue.toLowerCase().endsWith(strCompareValue.toLowerCase());
    default: return false;
  }
}

// Safe field transformation
function transformField(value: unknown, operation: string, param?: string | number): unknown {
  const strValue = String(value ?? '');
  const numValue = parseFloat(strValue);

  switch (operation) {
    case 'uppercase': return strValue.toUpperCase();
    case 'lowercase': return strValue.toLowerCase();
    case 'trim': return strValue.trim();
    case 'prefix': return `${param ?? ''}${strValue}`;
    case 'suffix': return `${strValue}${param ?? ''}`;
    case 'replace': return strValue; // Would need more params, simplified
    case 'add': return !isNaN(numValue) ? numValue + Number(param ?? 0) : value;
    case 'subtract': return !isNaN(numValue) ? numValue - Number(param ?? 0) : value;
    case 'multiply': return !isNaN(numValue) ? numValue * Number(param ?? 1) : value;
    case 'divide': return !isNaN(numValue) && Number(param) !== 0 ? numValue / Number(param ?? 1) : value;
    case 'round': return !isNaN(numValue) ? Math.round(numValue) : value;
    case 'floor': return !isNaN(numValue) ? Math.floor(numValue) : value;
    case 'ceil': return !isNaN(numValue) ? Math.ceil(numValue) : value;
    default: return value;
  }
}

export async function run(args: {
  inputPath: string;
  outputPath: string;
  operation: string;
  config: TransformConfig;
}): Promise<string> {
  const { inputPath, outputPath, operation, config } = args;

  // 1. Validate inputs
  if (!inputPath || !outputPath || !operation || !config) {
    return 'Error: inputPath, outputPath, operation, and config are all required.';
  }

  // 2. Resolve Paths
  const absInput = path.resolve(process.cwd(), inputPath);
  const absOutput = path.resolve(process.cwd(), outputPath);

  if (!fs.existsSync(absInput)) {
    return `Error: Input file not found at ${absInput}`;
  }

  try {
    // 3. Read & Parse
    const fileContent = fs.readFileSync(absInput, 'utf-8');
    const rows: Row[] = parse(fileContent, {
      columns: true,
      skip_empty_lines: true
    });

    const originalCount = rows.length;
    let resultRows: Row[] = rows;

    // 4. Apply safe operation
    switch (operation) {
      case 'filter': {
        if (!config.field || !config.operator) {
          return 'Error: filter operation requires field and operator in config';
        }
        resultRows = rows.filter(row =>
          compare(row[config.field!], config.operator!, config.value)
        );
        break;
      }

      case 'sort': {
        if (!config.field) {
          return 'Error: sort operation requires field in config';
        }
        const direction = config.direction === 'desc' ? -1 : 1;
        resultRows = [...rows].sort((a, b) => {
          const aVal = String(a[config.field!] ?? '');
          const bVal = String(b[config.field!] ?? '');
          const aNum = parseFloat(aVal);
          const bNum = parseFloat(bVal);

          // Numeric sort if both are numbers
          if (!isNaN(aNum) && !isNaN(bNum)) {
            return (aNum - bNum) * direction;
          }
          // String sort otherwise
          return aVal.localeCompare(bVal) * direction;
        });
        break;
      }

      case 'select_columns': {
        if (!config.columns || config.columns.length === 0) {
          return 'Error: select_columns operation requires columns array in config';
        }
        resultRows = rows.map(row => {
          const newRow: Row = {};
          for (const col of config.columns!) {
            if (col in row) {
              newRow[col] = row[col];
            }
          }
          return newRow;
        });
        break;
      }

      case 'map': {
        if (!config.transforms || Object.keys(config.transforms).length === 0) {
          return 'Error: map operation requires transforms object in config';
        }
        resultRows = rows.map(row => {
          const newRow = { ...row };
          for (const [field, transform] of Object.entries(config.transforms!)) {
            if (field in newRow) {
              newRow[field] = transformField(newRow[field], transform.operation, transform.value);
            }
          }
          return newRow;
        });
        break;
      }

      case 'aggregate': {
        if (!config.columns || !config.aggregateFunc) {
          return 'Error: aggregate operation requires columns (group by) and aggregateFunc in config';
        }

        const groups = new Map<string, Row[]>();

        // Group rows
        for (const row of rows) {
          const key = config.columns!.map(col => String(row[col] ?? '')).join('|');
          if (!groups.has(key)) {
            groups.set(key, []);
          }
          groups.get(key)!.push(row);
        }

        // Aggregate each group
        resultRows = [];
        for (const [, groupRows] of groups) {
          const aggregatedRow: Row = {};

          // Copy group-by columns
          for (const col of config.columns!) {
            aggregatedRow[col] = groupRows[0][col];
          }

          // Calculate aggregate
          if (config.aggregateField) {
            const values = groupRows.map(r => parseFloat(String(r[config.aggregateField!] ?? 0))).filter(n => !isNaN(n));

            switch (config.aggregateFunc) {
              case 'count':
                aggregatedRow[`${config.aggregateField}_count`] = groupRows.length;
                break;
              case 'sum':
                aggregatedRow[`${config.aggregateField}_sum`] = values.reduce((a, b) => a + b, 0);
                break;
              case 'avg':
                aggregatedRow[`${config.aggregateField}_avg`] = values.length > 0
                  ? values.reduce((a, b) => a + b, 0) / values.length
                  : 0;
                break;
              case 'min':
                aggregatedRow[`${config.aggregateField}_min`] = Math.min(...values);
                break;
              case 'max':
                aggregatedRow[`${config.aggregateField}_max`] = Math.max(...values);
                break;
            }
          } else {
            aggregatedRow['count'] = groupRows.length;
          }

          resultRows.push(aggregatedRow);
        }
        break;
      }

      case 'deduplicate': {
        const seen = new Set<string>();
        const keyFields = config.columns || Object.keys(rows[0] || {});

        resultRows = rows.filter(row => {
          const key = keyFields.map(f => String(row[f] ?? '')).join('|');
          if (seen.has(key)) {
            return false;
          }
          seen.add(key);
          return true;
        });
        break;
      }

      default:
        return `Error: Unknown operation '${operation}'. Supported: filter, map, sort, select_columns, aggregate, deduplicate`;
    }

    // 5. Write Output
    const outputContent = stringify(resultRows, { header: true });
    fs.writeFileSync(absOutput, outputContent, 'utf-8');

    return `Success! Transformed ${originalCount} rows -> ${resultRows.length} rows.\nOperation: ${operation}\nSaved to: ${outputPath}`;

  } catch (error: unknown) {
    return `Critical Error: ${(error as Error).message}`;
  }
}
