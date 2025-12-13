/* NEO_SKILL_META
{
  "name": "regex_builder",
  "description": "Build, test, and explain regular expressions. Includes common pattern library and plain English explanations of regex patterns.",
  "argsSchema": {
    "type": "object",
    "properties": {
      "action": {
        "type": "string",
        "enum": ["test", "explain", "build", "library"],
        "description": "Action to perform"
      },
      "pattern": { "type": "string", "description": "Regex pattern (for test/explain)" },
      "testString": { "type": "string", "description": "String to test against pattern" },
      "flags": { "type": "string", "description": "Regex flags (g, i, m, s, u)" },
      "buildSpec": {
        "type": "object",
        "description": "Specification for building regex",
        "properties": {
          "type": { "type": "string", "enum": ["email", "url", "phone", "date", "ip", "uuid", "credit_card", "custom"] },
          "customRules": { "type": "array", "items": { "type": "string" }, "description": "Custom rules for building" }
        }
      }
    },
    "required": ["action"]
  }
}
NEO_SKILL_META */

interface RegexArgs {
  action: 'test' | 'explain' | 'build' | 'library';
  pattern?: string;
  testString?: string;
  flags?: string;
  buildSpec?: {
    type: 'email' | 'url' | 'phone' | 'date' | 'ip' | 'uuid' | 'credit_card' | 'custom';
    customRules?: string[];
  };
}

// Common regex patterns library
const PATTERN_LIBRARY: Record<string, { pattern: string; description: string; example: string }> = {
  email: {
    pattern: '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$',
    description: 'Standard email address validation',
    example: 'user@example.com'
  },
  url: {
    pattern: '^https?:\\/\\/(?:www\\.)?[-a-zA-Z0-9@:%._\\+~#=]{1,256}\\.[a-zA-Z0-9()]{1,6}\\b(?:[-a-zA-Z0-9()@:%_\\+.~#?&\\/=]*)$',
    description: 'HTTP/HTTPS URL validation',
    example: 'https://example.com/path?query=1'
  },
  phone_us: {
    pattern: '^(?:\\+1)?[-. ]?\\(?\\d{3}\\)?[-. ]?\\d{3}[-. ]?\\d{4}$',
    description: 'US phone number (various formats)',
    example: '(555) 123-4567'
  },
  phone_intl: {
    pattern: '^\\+?[1-9]\\d{1,14}$',
    description: 'International phone (E.164 format)',
    example: '+14155551234'
  },
  date_iso: {
    pattern: '^\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])$',
    description: 'ISO 8601 date format (YYYY-MM-DD)',
    example: '2024-01-15'
  },
  date_us: {
    pattern: '^(?:0[1-9]|1[0-2])\\/(?:0[1-9]|[12]\\d|3[01])\\/\\d{4}$',
    description: 'US date format (MM/DD/YYYY)',
    example: '01/15/2024'
  },
  time_24h: {
    pattern: '^(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d)?$',
    description: '24-hour time format',
    example: '14:30:00'
  },
  ipv4: {
    pattern: '^(?:(?:25[0-5]|2[0-4]\\d|[01]?\\d\\d?)\\.){3}(?:25[0-5]|2[0-4]\\d|[01]?\\d\\d?)$',
    description: 'IPv4 address',
    example: '192.168.1.1'
  },
  ipv6: {
    pattern: '^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$',
    description: 'IPv6 address (full format)',
    example: '2001:0db8:85a3:0000:0000:8a2e:0370:7334'
  },
  uuid: {
    pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
    description: 'UUID v1-v5',
    example: '550e8400-e29b-41d4-a716-446655440000'
  },
  credit_card: {
    pattern: '^(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})$',
    description: 'Credit card number (Visa, MC, Amex, Discover)',
    example: '4111111111111111'
  },
  hex_color: {
    pattern: '^#?(?:[0-9a-fA-F]{3}){1,2}$',
    description: 'Hex color code',
    example: '#FF5733'
  },
  slug: {
    pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
    description: 'URL-friendly slug',
    example: 'my-blog-post-title'
  },
  username: {
    pattern: '^[a-zA-Z0-9_-]{3,16}$',
    description: 'Username (3-16 chars, alphanumeric, underscore, dash)',
    example: 'john_doe123'
  },
  password_strong: {
    pattern: '^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[@$!%*?&])[A-Za-z\\d@$!%*?&]{8,}$',
    description: 'Strong password (8+ chars, upper, lower, digit, special)',
    example: 'Secure@123'
  },
  semantic_version: {
    pattern: '^(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)(?:-[\\da-zA-Z-]+(?:\\.[\\da-zA-Z-]+)*)?(?:\\+[\\da-zA-Z-]+(?:\\.[\\da-zA-Z-]+)*)?$',
    description: 'Semantic version (semver)',
    example: '1.2.3-beta.1+build.123'
  },
  file_extension: {
    pattern: '\\.[a-zA-Z0-9]+$',
    description: 'File extension',
    example: '.txt'
  },
  html_tag: {
    pattern: '<\\/?[a-zA-Z][a-zA-Z0-9]*(?:\\s+[a-zA-Z-]+(?:=(?:"[^"]*"|\'[^\']*\'|[^\\s>]+))?)*\\s*\\/?>',
    description: 'HTML tag',
    example: '<div class="container">'
  }
};

// Regex syntax explanations
const SYNTAX_EXPLANATIONS: Record<string, string> = {
  '^': 'Start of string/line',
  '$': 'End of string/line',
  '.': 'Any single character (except newline)',
  '*': 'Zero or more of the preceding',
  '+': 'One or more of the preceding',
  '?': 'Zero or one of the preceding (optional)',
  '\\d': 'Any digit (0-9)',
  '\\D': 'Any non-digit',
  '\\w': 'Any word character (letter, digit, underscore)',
  '\\W': 'Any non-word character',
  '\\s': 'Any whitespace (space, tab, newline)',
  '\\S': 'Any non-whitespace',
  '\\b': 'Word boundary',
  '\\B': 'Non-word boundary',
  '[abc]': 'Any of a, b, or c',
  '[^abc]': 'Any character except a, b, or c',
  '[a-z]': 'Any lowercase letter',
  '[A-Z]': 'Any uppercase letter',
  '[0-9]': 'Any digit',
  '(...)': 'Capturing group',
  '(?:...)': 'Non-capturing group',
  '(?=...)': 'Positive lookahead',
  '(?!...)': 'Negative lookahead',
  '(?<=...)': 'Positive lookbehind',
  '(?<!...)': 'Negative lookbehind',
  '{n}': 'Exactly n occurrences',
  '{n,}': 'n or more occurrences',
  '{n,m}': 'Between n and m occurrences',
  '|': 'Alternation (OR)',
  '\\': 'Escape special character'
};

export async function run(args: RegexArgs): Promise<string> {
  const { action, pattern, testString, flags = '', buildSpec } = args;

  if (!action) {
    return 'Error: action is required (test, explain, build, library)';
  }

  switch (action) {
    case 'test':
      return testRegex(pattern, testString, flags);
    case 'explain':
      return explainRegex(pattern);
    case 'build':
      return buildRegex(buildSpec);
    case 'library':
      return showLibrary();
    default:
      return `Error: Unknown action "${action}"`;
  }
}

function testRegex(pattern: string | undefined, testString: string | undefined, flags: string): string {
  if (!pattern) {
    return 'Error: pattern is required for test action';
  }
  if (testString === undefined) {
    return 'Error: testString is required for test action';
  }

  try {
    const regex = new RegExp(pattern, flags);
    const lines: string[] = [];

    lines.push(`Pattern: /${pattern}/${flags}`);
    lines.push(`Test string: "${testString}"`);
    lines.push('');

    const isMatch = regex.test(testString);
    lines.push(`Match: ${isMatch ? 'Yes' : 'No'}`);

    if (isMatch) {
      // Reset regex for global matching
      regex.lastIndex = 0;

      if (flags.includes('g')) {
        // Global matches
        const matches = testString.matchAll(new RegExp(pattern, flags));
        const matchArray = [...matches];
        lines.push(`\nFound ${matchArray.length} match(es):`);

        for (let i = 0; i < matchArray.length; i++) {
          const match = matchArray[i];
          lines.push(`  [${i + 1}] "${match[0]}" at index ${match.index}`);
          if (match.length > 1) {
            for (let g = 1; g < match.length; g++) {
              lines.push(`      Group ${g}: "${match[g]}"`);
            }
          }
        }
      } else {
        // Single match
        const match = testString.match(regex);
        if (match) {
          lines.push(`\nMatch: "${match[0]}" at index ${match.index}`);
          if (match.length > 1) {
            lines.push('Captured groups:');
            for (let g = 1; g < match.length; g++) {
              lines.push(`  Group ${g}: "${match[g]}"`);
            }
          }
        }
      }
    }

    return lines.join('\n');
  } catch (e: unknown) {
    return `Error: Invalid regex pattern - ${(e as Error).message}`;
  }
}

function explainRegex(pattern: string | undefined): string {
  if (!pattern) {
    return 'Error: pattern is required for explain action';
  }

  const lines: string[] = [];
  lines.push(`Pattern: /${pattern}/`);
  lines.push('');
  lines.push('=== Breakdown ===');

  // Tokenize and explain
  let i = 0;
  let position = 0;

  while (i < pattern.length) {
    const char = pattern[i];
    let explanation = '';
    let token = char;

    if (char === '\\' && i + 1 < pattern.length) {
      token = pattern.substring(i, i + 2);
      explanation = SYNTAX_EXPLANATIONS[token] || `Escaped character: ${pattern[i + 1]}`;
      i += 2;
    } else if (char === '[') {
      // Character class
      const endBracket = pattern.indexOf(']', i + 1);
      if (endBracket !== -1) {
        token = pattern.substring(i, endBracket + 1);
        if (token[1] === '^') {
          explanation = `Any character NOT in: ${token.substring(2, token.length - 1)}`;
        } else {
          explanation = `Any character in: ${token.substring(1, token.length - 1)}`;
        }
        i = endBracket + 1;
      } else {
        i++;
      }
    } else if (char === '(') {
      // Group
      if (pattern.substring(i, i + 3) === '(?:') {
        token = '(?:...)';
        explanation = 'Non-capturing group';
        i += 3;
      } else if (pattern.substring(i, i + 3) === '(?=') {
        token = '(?=...)';
        explanation = 'Positive lookahead';
        i += 3;
      } else if (pattern.substring(i, i + 3) === '(?!') {
        token = '(?!...)';
        explanation = 'Negative lookahead';
        i += 3;
      } else if (pattern.substring(i, i + 4) === '(?<=') {
        token = '(?<=...)';
        explanation = 'Positive lookbehind';
        i += 4;
      } else if (pattern.substring(i, i + 4) === '(?<!') {
        token = '(?<!...)';
        explanation = 'Negative lookbehind';
        i += 4;
      } else {
        token = '(...)';
        explanation = 'Capturing group';
        i++;
      }
    } else if (char === '{') {
      // Quantifier
      const endBrace = pattern.indexOf('}', i);
      if (endBrace !== -1) {
        token = pattern.substring(i, endBrace + 1);
        const inner = token.substring(1, token.length - 1);
        if (inner.includes(',')) {
          const [min, max] = inner.split(',');
          if (max === '') {
            explanation = `${min} or more occurrences`;
          } else {
            explanation = `Between ${min} and ${max} occurrences`;
          }
        } else {
          explanation = `Exactly ${inner} occurrences`;
        }
        i = endBrace + 1;
      } else {
        i++;
      }
    } else if (SYNTAX_EXPLANATIONS[char]) {
      explanation = SYNTAX_EXPLANATIONS[char];
      i++;
    } else {
      explanation = `Literal character: ${char}`;
      i++;
    }

    lines.push(`  [${position}] ${token.padEnd(10)} -> ${explanation}`);
    position++;
  }

  // Add flag explanations if common
  lines.push('');
  lines.push('=== Common Flags ===');
  lines.push('  g - Global (find all matches)');
  lines.push('  i - Case insensitive');
  lines.push('  m - Multiline (^ and $ match line boundaries)');
  lines.push('  s - Dotall (. matches newlines)');
  lines.push('  u - Unicode');

  return lines.join('\n');
}

function buildRegex(spec: RegexArgs['buildSpec']): string {
  if (!spec || !spec.type) {
    return 'Error: buildSpec with type is required for build action';
  }

  if (spec.type !== 'custom') {
    const mapping: Record<string, string> = {
      email: 'email',
      url: 'url',
      phone: 'phone_us',
      date: 'date_iso',
      ip: 'ipv4',
      uuid: 'uuid',
      credit_card: 'credit_card'
    };

    const patternKey = mapping[spec.type];
    if (patternKey && PATTERN_LIBRARY[patternKey]) {
      const lib = PATTERN_LIBRARY[patternKey];
      return `Built-in pattern for: ${spec.type}\n\nPattern: ${lib.pattern}\nDescription: ${lib.description}\nExample: ${lib.example}\n\nUsage in JavaScript:\nconst regex = new RegExp('${lib.pattern}');\nconst isValid = regex.test(yourString);`;
    }
  }

  // Custom build
  if (spec.customRules && spec.customRules.length > 0) {
    const parts: string[] = [];

    for (const rule of spec.customRules) {
      const lowerRule = rule.toLowerCase();

      if (lowerRule.includes('starts with')) {
        const value = rule.split('starts with')[1]?.trim();
        if (value) parts.push(`^${escapeRegex(value)}`);
      } else if (lowerRule.includes('ends with')) {
        const value = rule.split('ends with')[1]?.trim();
        if (value) parts.push(`${escapeRegex(value)}$`);
      } else if (lowerRule.includes('contains')) {
        const value = rule.split('contains')[1]?.trim();
        if (value) parts.push(escapeRegex(value));
      } else if (lowerRule.includes('digits only')) {
        parts.push('^\\d+$');
      } else if (lowerRule.includes('letters only')) {
        parts.push('^[a-zA-Z]+$');
      } else if (lowerRule.includes('alphanumeric')) {
        parts.push('^[a-zA-Z0-9]+$');
      } else if (lowerRule.includes('length')) {
        const match = rule.match(/length\s*(?:of\s*)?(\d+)(?:\s*-\s*|\s+to\s+)(\d+)?/i);
        if (match) {
          const min = match[1];
          const max = match[2] || '';
          parts.push(`.{${min},${max}}`);
        }
      }
    }

    if (parts.length > 0) {
      const combined = parts.join('');
      return `Custom pattern built from rules:\n\nRules: ${spec.customRules.join(', ')}\nPattern: ${combined}\n\nNote: This is a basic pattern. Review and adjust as needed.`;
    }
  }

  return 'Error: Could not build pattern from provided specification';
}

function showLibrary(): string {
  const lines: string[] = [];
  lines.push('=== Regex Pattern Library ===');
  lines.push('');

  for (const [name, info] of Object.entries(PATTERN_LIBRARY)) {
    lines.push(`[${name}]`);
    lines.push(`  Description: ${info.description}`);
    lines.push(`  Pattern: ${info.pattern}`);
    lines.push(`  Example: ${info.example}`);
    lines.push('');
  }

  lines.push('Usage: Use action "build" with buildSpec.type to get a specific pattern');

  return lines.join('\n');
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
