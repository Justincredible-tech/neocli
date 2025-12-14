# NeoCLI

<div align="center">

```
~~~~~~~~~~~~~~~~~~~~~~~~~~~
01111110 01100101 01101111 01
███╗010██╗███████╗ ██████╗010
████╗01██║██╔════╝██╔══ ██╗01
██╔██╗0██║█████╗01██║101██║10
██║╚██╗██║██╔══╝10██║010██║01
██║1╚████║███████╗╚██████╔╝10
╚═╝01╚═══╝╚══════╝ ╚═════╝101 
1111110 01100101 011011110 10
The choice is yours. 1111110
~~~~~~~~~~~~~~~~~~~~~~~~~~~
```

**The Open Source AI Coding Agent for Your Terminal**

*An alternative to Claude Code, Gemini CLI, and Codex — powered entirely by local LLMs via Ollama*

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![Ollama](https://img.shields.io/badge/Ollama-Required-purple.svg)](https://ollama.ai/)

</div>

---

## What is NeoCLI?

NeoCLI is a **fully local, privacy-first AI coding assistant** that runs in your terminal. Unlike cloud-based alternatives, NeoCLI connects to [Ollama](https://ollama.ai/) to run large language models entirely on your machine — your code never leaves your computer.

### Why NeoCLI?

- **100% Local & Private** — Your code stays on your machine. No API keys, no cloud, no data collection.
- **Self-Improving** — NeoCLI learns by creating reusable "skills" that persist across sessions.
- **Feature-Rich** — Slash commands, task tracking, code review, web search, and more.
- **Open Source** — MIT licensed. Inspect, modify, and contribute freely.
- **Model Agnostic** — Use any model Ollama and your hardware supports: Llama, Qwen, CodeLlama, Mistral, and more.

---

## Features

### Core Capabilities

| Feature | Description |
|---------|-------------|
| **Intelligent Code Editing** | Diff-based edits with exact string matching and preview |
| **Codebase Navigation** | Search, grep, and map your entire project structure |
| **File Operations** | Read, write, and edit files with security validation |
| **Web Search** | Search the web for documentation and solutions |
| **Task Tracking** | Visual progress tracking for multi-step tasks |
| **Git Integration** | Smart commits, status, diff, and branch operations |
| **Test Running** | Execute tests across Jest, Mocha, pytest, and more |
| **API Client** | Make HTTP requests with auth token support |
| **SQLite Database** | Built-in database for persistent storage |

### Self-Improving Skills System

NeoCLI's **unique superpower** is its ability to create and save reusable skills:

```
You: "Parse this CSV file and convert it to JSON"

Neo: I'll create a csv_to_json skill for this...
     [Creates .neo/skills/csv_to_json.ts]
     Skill created! Now executing...

     Done! This skill is now permanently available.
```

Skills are TypeScript functions that persist in `.neo/skills/` and automatically become available as tools. Over time, NeoCLI becomes more capable as it builds a library of skills tailored to your workflows.

### Slash Commands

| Command | Description |
|---------|-------------|
| `/help` | Show all available commands |
| `/clear` | Clear conversation history and start fresh |
| `/compact` | Summarize conversation to save context tokens |
| `/status` | Show system status (model, connection, tools) |
| `/model` | Display current model configuration |
| `/review [path]` | Perform a code review |
| `/plan <task>` | Create an implementation plan before coding |
| `/bug <description>` | Debug and fix an issue |
| `/test [path]` | Run project tests |
| `/commit` | Create a smart git commit |
| `/tools` | List all available tools and skills |
| `/map` | Show project structure |
| `/history` | View conversation history |
| `/init` | Create NEO.md project configuration |

### Project Configuration (NEO.md)

Create a `NEO.md` file in your project root to give NeoCLI project-specific context:

```markdown
# Project Configuration for NeoCLI

## Project Overview
This is a React e-commerce application with a Node.js backend.

## Tech Stack
- Frontend: React 18, TypeScript, TailwindCSS
- Backend: Node.js, Express, PostgreSQL
- Testing: Jest, React Testing Library

## Code Style Guidelines
- Use functional components with hooks
- Prefer named exports
- Use absolute imports from src/

## Do NOT
- Modify database migrations directly
- Commit .env files
```

---

## Installation

### Prerequisites

1. **Node.js 18+** — [Download](https://nodejs.org/)
2. **Ollama** — [Download](https://ollama.ai/)
3. **A Code Model** - We recommend `qwen3-coder:30b`

### Install Ollama & Model

```bash
# Install Ollama (macOS/Linux)
curl -fsSL https://ollama.ai/install.sh | sh

# For Windows, download from https://ollama.ai/download

# Pull a coding model
ollama pull qwen3-coder:30b

# Or use a smaller model for less powerful hardware
ollama pull qwen2.5-coder:7b
```

### Install NeoCLI

```bash
# Clone the repository
git clone https://github.com/Justincredible-tech/neocli.git
cd neocli

# Install dependencies
npm install

# Build the project
npm run build

# Link globally (optional)
npm link
```

### Verify Installation

```bash
# Start Ollama (if not running)
ollama serve

# Run NeoCLI
npm start
# Or if linked globally:
neo
```

---

## Quick Start

### Interactive Mode

```bash
neo
```

This launches the interactive REPL where you can chat with Neo:

```
~~~~~~~~~~~~~~~~~~~~~~~~~~~
01111110 01100101 01101111 01
███╗010██╗███████╗ ██████╗010
████╗01██║██╔════╝██╔══ ██╗01
██╔██╗0██║█████╗01██║101██║10
██║╚██╗██║██╔══╝10██║010██║01
██║1╚████║███████╗╚██████╔╝10
╚═╝01╚═══╝╚══════╝ ╚═════╝101 
1111110 01100101 011011110 10
The choice is yours. 1111110
~~~~~~~~~~~~~~~~~~~~~~~~~~~
...

Neo > explain this codebase
Neo > fix the bug in src/auth.ts
Neo > /review src/
Neo > add input validation to the signup form
```

### Single Command Mode

```bash
# Run a single prompt and exit
neo "explain what this project does"

# With explicit prompt flag
neo -p "add error handling to api.ts"
```

### Command Line Options

```
Usage: neo [options] [prompt]

Options:
  -p, --prompt <text>    Run with a prompt and exit
  -n, --non-interactive  Run in non-interactive mode
  --help                 Show help message
  --version              Show version number
```

---

## Configuration

### Environment Variables

Create a `.env` file in the project root:

```env
# Ollama Configuration
OLLAMA_HOST=http://127.0.0.1:11434
DEFAULT_MODEL=qwen3-coder:30b
EMBEDDING_MODEL=nomic-embed-text

# Context & Performance
CONTEXT_WINDOW_SIZE=32768
LLM_TIMEOUT_MS=300000
MAX_AGENT_STEPS=30

# Safety
REQUIRE_APPROVAL=true
```

### Model Recommendations

| Hardware | Recommended Model | Context |
|----------|-------------------|---------|
| 32GB+ RAM / RTX 4090 | `qwen3-coder:30b` | 32K |
| 32GB RAM / RTX 3090 | `qwen2.5-coder:14b` | 16K |
| 16GB RAM / RTX 3080 | `qwen2.5-coder:7b` | 8K |
| 8GB RAM / M1 Mac | `qwen2.5-coder:3b` | 4K |

---

## Tools Reference

### File Operations

| Tool | Description |
|------|-------------|
| `read_file` | Read file contents with optional line range |
| `write_file` | Create or overwrite files |
| `edit_file` | Find and replace specific content (preferred for edits) |
| `list_files` | List directory contents with filtering |

### Code Intelligence

| Tool | Description |
|------|-------------|
| `recursive_grep` | Search code with regex patterns |
| `generate_repo_map` | Generate project structure map |
| `strategic_code_scanner` | High-level codebase analysis |
| `web_search` | Search the web for information |

### Task Management

| Tool | Description |
|------|-------------|
| `todo` | Track tasks with visual progress |

### Built-in Skills

| Skill | Description |
|-------|-------------|
| `shell_executor` | Run shell commands safely |
| `git_automator` | Git operations (status, commit, diff, log) |
| `web_fetcher` | Fetch and convert web pages to markdown |
| `smart_file_editor` | Advanced file editing with regex |
| `test_runner` | Run tests (Jest, Mocha, pytest, etc.) |
| `api_client` | Make HTTP requests |
| `sqlite_manager` | SQLite database operations |

---

## Architecture

```
neocli/
├── src/
│   ├── index.ts              # Entry point & REPL
│   ├── config.ts             # Centralized configuration
│   ├── core/
│   │   ├── agent.ts          # Cognitive loop & reasoning
│   │   ├── llm.ts            # Ollama API client
│   │   ├── commands.ts       # Slash command system
│   │   ├── skills.ts         # Skill loader & manager
│   │   ├── memory_store.ts   # Semantic long-term memory
│   │   └── mcp.ts            # MCP protocol (extensibility)
│   ├── tools/                # Core tools
│   │   ├── read_file.ts
│   │   ├── write_file.ts
│   │   ├── edit_file.ts
│   │   ├── list_files.ts
│   │   ├── web_search.ts
│   │   ├── todo.ts
│   │   └── ...
│   ├── utils/
│   │   ├── security.ts       # Path validation, SSRF protection
│   │   ├── ui.ts             # Terminal UI components
│   │   └── logger.ts         # Structured logging
│   └── types/
│       └── index.ts          # TypeScript type definitions
├── .neo/
│   ├── skills/               # User-created skills
│   ├── commands/             # Custom slash commands
│   └── memory.json           # Chat history
├── NEO.md                    # Project configuration
└── package.json
```

---

## Comparison

| Feature | NeoCLI | Claude Code | Gemini CLI | Codex |
|---------|:------:|:-----------:|:----------:|:-----:|
| **100% Local** | ✅ | ❌ | ❌ | ❌ |
| **No API Key Required** | ✅ | ❌ | ❌ | ❌ |
| **Open Source** | ✅ | ❌ | ✅ | ✅ |
| **Self-Improving Skills** | ✅ | ❌ | ❌ | ✅ |
| **Semantic Memory** | ✅ | ❌ | ❌ | ❌ |
| **Slash Commands** | ✅ | ✅ | ✅ | ✅ |
| **Code Review Mode** | ✅ | ✅ | ❌ | ✅ |
| **Task Tracking** | ✅ | ✅ | ❌ | ✅ |
| **Web Search** | ✅ | ✅ | ✅ | ✅ |
| **Project Config File** | ✅ | ✅ | ✅ | ✅ |
| **Model Choice** | Any | Claude | Gemini | GPT |

---

## Creating Custom Skills

Skills are TypeScript files in `.neo/skills/` with a special metadata header:

```typescript
/* NEO_SKILL_META
{
  "name": "my_custom_skill",
  "description": "What this skill does and when to use it",
  "argsSchema": {
    "type": "object",
    "properties": {
      "input": { "type": "string", "description": "The input to process" }
    },
    "required": ["input"]
  }
}
NEO_SKILL_META */

export async function run(args: { input: string }): Promise<string> {
  // Your skill logic here
  return `Processed: ${args.input}`;
}
```

Skills are automatically loaded at startup and become available as tools.

---

## Creating Custom Commands

Create `.md` files in `.neo/commands/` to add custom slash commands:

**`.neo/commands/deploy.md`**
```markdown
Deploy the application to production:

1. First run all tests to ensure nothing is broken
2. Build the production bundle
3. Run the deployment script at scripts/deploy.sh
4. Verify the deployment was successful

{{args}}
```

Now `/deploy staging` will execute this prompt with "staging" as the argument.

---

## Security

NeoCLI includes multiple security layers:

- **Path Validation** — Prevents directory traversal attacks
- **SSRF Protection** — Blocks requests to localhost and internal IPs
- **SQL Injection Prevention** — Parameterized queries only
- **Command Injection Prevention** — Uses `execFile` instead of `exec`
- **Approval Prompts** — High-risk operations require user confirmation
- **Blocked Files** — Prevents access to `.env`, SSH keys, credentials

---

## Troubleshooting

### "Ollama not available"

```bash
# Check if Ollama is running
curl http://localhost:11434/api/tags

# Start Ollama
ollama serve
```

### "Model not found"

```bash
# List available models
ollama list

# Pull the model
ollama pull qwen2.5-coder:32b
```

### Slow responses

- If you hit a timeout, just rerun the prompt; the agent now trims repo maps to reduce token load.
- Reduce `CONTEXT_WINDOW_SIZE` in `.env` if needed.
- Ensure Ollama has GPU acceleration enabled.

### Out of memory

- Use a quantized model (e.g., `qwen2.5-coder:7b-q4_0`)
- Close other applications
- Reduce context window size

---

## Contributing

We welcome contributions! Here's how to get started:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run tests (`npm test`)
5. Commit (`git commit -m 'Add amazing feature'`)
6. Push (`git push origin feature/amazing-feature`)
7. Open a Pull Request

### Development Setup

```bash
# Install dependencies
npm install

# Run in development mode (with auto-reload)
npm run dev

# Run type checking
npm run typecheck

# Build for production
npm run build
```

---

## Roadmap

- [ ] Full MCP (Model Context Protocol) implementation
- [ ] IDE extensions (VS Code, JetBrains)
- [ ] Image/screenshot analysis
- [ ] Voice input support
- [ ] Multi-agent collaboration
- [ ] Plugin marketplace for skills

---

## License

MIT License — see [LICENSE](LICENSE) for details.

---

## Acknowledgments

- [Ollama](https://ollama.ai/) — For making local LLMs accessible
- [Anthropic](https://anthropic.com/) — For Claude Code inspiration
- [Google](https://github.com/google-gemini/gemini-cli) — For Gemini CLI inspiration
- [OpenAI](https://github.com/openai/codex) — For Codex CLI inspiration

---

<div align="center">

**Built with the belief that AI coding assistants should be open, private, and run on your hardware.**

[Report Bug](https://github.com/Justincredible-tech/neocli/issues) · [Request Feature](https://github.com/Justincredible-tech/neocli/issues) · [Discussions](https://github.com/Justincredible-tech/neocli/discussions)

</div>
