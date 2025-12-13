/* NEO_SKILL_META
{
  "name": "test_runner",
  "description": "Executes automated tests (unit, integration, E2E) for different frameworks (Jest, Mocha, pytest, etc.) and analyzes results",
  "argsSchema": {
    "type": "object",
    "properties": {
      "framework": { "type": "string", "description": "Test framework to use (jest, mocha, pytest, jasmine, cucumber)" },
      "testPath": { "type": "string", "description": "Path to test files or directory" },
      "verbose": { "type": "boolean", "description": "Enable verbose output (default: false)" },
      "watch": { "type": "boolean", "description": "Watch mode (default: false)" },
      "coverage": { "type": "boolean", "description": "Generate coverage report (default: false)" },
      "timeout": { "type": "number", "description": "Test timeout in milliseconds (default: 30000)" }
    },
    "required": ["framework", "testPath"]
  }
}
NEO_SKILL_META */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execAsync = promisify(exec);

interface TestRunnerArgs {
  framework: string;
  testPath: string;
  verbose?: boolean;
  watch?: boolean;
  coverage?: boolean;
  timeout?: number;
}

export async function run(args: TestRunnerArgs): Promise<string> {
  const { framework, testPath, verbose = false, watch = false, coverage = false, timeout = 30000 } = args;

  // Validate required parameters
  if (!framework) {
    return "Error: 'framework' parameter is required.";
  }
  if (!testPath) {
    return "Error: 'testPath' parameter is required.";
  }

  // Validate framework
  const supportedFrameworks = ['jest', 'mocha', 'pytest', 'jasmine', 'cucumber', 'vitest'];
  if (!supportedFrameworks.includes(framework.toLowerCase())) {
    return `Error: Unsupported framework '${framework}'. Supported frameworks: ${supportedFrameworks.join(', ')}`;
  }

  // Validate test path
  const absPath = path.resolve(process.cwd(), testPath);
  if (!fs.existsSync(absPath)) {
    return `Error: Test path not found at ${absPath}`;
  }

  try {
    let cmd = '';
    let frameworkName = '';

    switch (framework.toLowerCase()) {
      case 'jest':
        frameworkName = 'Jest';
        cmd = `npx jest "${absPath}"`;
        if (verbose) cmd += ' --verbose';
        if (watch) cmd += ' --watch';
        if (coverage) cmd += ' --coverage';
        cmd += ` --testTimeout=${timeout}`;
        break;

      case 'vitest':
        frameworkName = 'Vitest';
        cmd = `npx vitest run "${absPath}"`;
        if (watch) cmd = `npx vitest "${absPath}"`;
        if (coverage) cmd += ' --coverage';
        break;

      case 'mocha':
        frameworkName = 'Mocha';
        cmd = `npx mocha "${absPath}" --timeout ${timeout}`;
        if (verbose) cmd += ' --reporter spec';
        break;

      case 'pytest':
        frameworkName = 'Pytest';
        cmd = `python -m pytest "${absPath}" -v`;
        if (coverage) cmd += ' --cov';
        cmd += ` --timeout=${Math.round(timeout / 1000)}`;
        break;

      case 'jasmine':
        frameworkName = 'Jasmine';
        cmd = `npx jasmine "${absPath}"`;
        break;

      case 'cucumber':
        frameworkName = 'Cucumber';
        cmd = `npx cucumber-js "${absPath}" --format progress`;
        break;

      default:
        return `Error: Unsupported framework '${framework}'`;
    }

    const result = await execAsync(cmd, {
      timeout,
      cwd: process.cwd(),
      env: { ...process.env, FORCE_COLOR: '0' }
    });

    let output = `${frameworkName} test suite completed!\n\n`;

    if (result.stdout) {
      output += `Output:\n${result.stdout.trim()}`;
    }

    if (result.stderr && result.stderr.trim()) {
      output += `\n\nWarnings/Info:\n${result.stderr.trim()}`;
    }

    return output;

  } catch (error: unknown) {
    const err = error as Error & { code?: number; stdout?: string; stderr?: string; killed?: boolean };

    if (err.killed) {
      return `Error: Test suite timed out after ${timeout}ms`;
    }

    // Test failures come through as errors in some frameworks
    let output = `${framework} tests completed with failures:\n\n`;

    if (err.stdout) {
      output += err.stdout;
    }

    if (err.stderr) {
      output += `\n\nErrors:\n${err.stderr}`;
    }

    if (!err.stdout && !err.stderr) {
      output = `Error running ${framework} tests: ${err.message}`;
    }

    return output;
  }
}
