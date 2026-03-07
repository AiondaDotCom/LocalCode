# LocalCode v2.0.0

AI coding agent for local LLMs. Built for macOS with MLX backend support.

LocalCode connects to a local LLM (MLX or Ollama), provides coding tools (file read/write, shell exec, web search), and uses native tool calling to act as a fully autonomous coding assistant — similar to Claude Code, but running entirely on your hardware.

## Features

- **Streaming responses** — live token-by-token output, no waiting
- **Native Qwen3 tool calling** — uses OpenAI-compatible `tools` parameter
- **MLX auto-start** — automatically starts the MLX server if not running
- **MLX auto-restart** — restarts the server on crash/hang during sessions
- **MCP support** — Model Context Protocol for external tool servers
- **CLAUDE.md compatible** — reads CLAUDE.md files in the same order as Claude Code
- **Permission system** — SAFE/DANGEROUS/BLOCKED tool classification with "always allow" option
- **Session management** — save/load chat sessions
- **14 built-in tools** — read, write, edit, bash, glob, grep, list, websearch, webopen, webfind, webfetch, task, todoread, todowrite

## Quick Start

```bash
# Install dependencies
npm install

# Build
npm run build

# Run (auto-starts MLX server if needed)
node dist/index.js

# Run with all permissions auto-approved
node dist/index.js --dangerously-skip-permissions
```

## Requirements

- Node.js 20+
- Python 3 with `mlx-lm` installed (`pip install mlx-lm`)
- macOS with Apple Silicon (for MLX backend)

## Configuration

Default config in `config/default.yaml`:

```yaml
backend: "mlx"

mlx:
  host: "127.0.0.1"
  port: 8000
  default_model: "nightmedia/Qwen3.5-35B-A3B-Text-qx64-hi-mlx"
  timeout: 300
  context_window: 32768
  max_tokens: 8192
```

The Qwen3 chat template is bundled in `config/qwen3_chat_template.jinja` and used automatically when starting the MLX server.

## Commands

```
/model [name]    Switch model or show current
/models          List available models
/tools           List available tools
/permissions     Show permission settings
/mcp             Show MCP server status
/save <name>     Save session
/load <name>     Load session
/sessions        List saved sessions
/pwd             Show working directory
/cd [path]       Change directory
/clear           Clear session
/help            Show help
/exit            Exit
```

## MCP Servers

Manage external MCP tool servers (compatible with Claude Code `.mcp.json` format):

```bash
# Add a server
node dist/index.js mcp add my-server -t stdio -- command arg1 arg2

# List servers
node dist/index.js mcp list

# Remove a server
node dist/index.js mcp remove my-server
```

## CLI Options

```
--backend <mlx|ollama>           Backend to use
--model <name>                   Model to use
--auto-yes                       Auto-approve all permissions
--auto-no                        Auto-deny all permissions
--dangerously-skip-permissions   Skip ALL permission checks
```

## Development

```bash
npm run dev          # Build in watch mode
npm run test         # Run tests (vitest)
npm run lint         # ESLint
npm run typecheck    # TypeScript strict check
```

## Architecture

```
src/
  index.ts           CLI entry point (commander)
  client.ts          MLX/Ollama HTTP client with streaming
  ui.ts              REPL interface with tool execution
  session.ts         Chat session management
  config.ts          YAML config loader
  permissions.ts     Permission system
  context.ts         CLAUDE.md file loader
  mlx.ts             MLX server start/stop/restart
  types.ts           Shared TypeScript types
  tools/
    file.ts          File tools (read, write, edit, glob, grep, list)
    exec.ts          Exec tools (bash, task, todoread, todowrite)
    web.ts           Web tools (websearch, webopen, webfind, webfetch)
  mcp/
    manager.ts       MCP server lifecycle
    registry.ts      MCP config registry (3 scopes)
    cli.ts           MCP CLI subcommands
    servers/local.ts Built-in tools as MCP
```

## License

MIT
