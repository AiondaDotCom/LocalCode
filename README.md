# LocalCode

A compact, Perl-based AI coding agent that provides an interactive terminal interface for AI-assisted programming tasks using local Ollama models.

![LocalCode in Action](example.png)

*LocalCode executing multiple tool calls in sequence: creating a Perl calculator, making it executable, and testing it - all from a single AI prompt.*

## Features

- **Local AI Models**: Works exclusively with Ollama - no cloud dependencies
- **Interactive Terminal UI**: Command-line interface with slash commands and TAB completion
- **Multiple Tool Execution**: AI can execute multiple tools in sequence for complete workflows
- **Tool Execution**: Secure permission-based system for running AI-requested tools
- **Comprehensive Tool Set**: 14 built-in tools including bash, read, write, edit, grep, glob, patch, webfetch, and more
- **XML Tool Parsing**: Robust parser for AI-generated tool calls with embedded quotes and complex content
- **Conversation Context**: Full conversation history preserved using Ollama's /api/chat endpoint
- **Smart Context Management**: Automatic history truncation when context limits are exceeded
- **Session Management**: Persistent conversation history with JSON storage
- **Test-Driven Development**: 310+ comprehensive tests ensuring reliability
- **Ultra-Compact**: ~1000 lines of Perl code for minimal LLM context usage

## Requirements

- Perl 5.10+
- Ollama running locally
- Term::ReadLine::Gnu (for enhanced CLI features)
- YAML::XS (for configuration)
- JSON (for session management)
- HTTP::Tiny (for Ollama API)
- File::Spec, File::Path (for file operations)

## Installation

### Quick Install (Recommended)

1. Clone the repository:
```bash
git clone <repository-url>
cd localcode
```

2. Install Perl dependencies:
```bash
cpan YAML::XS JSON HTTP::Tiny Term::ReadLine::Gnu
```

3. Build and install:
```bash
make install
```

This creates a single-file distribution and installs it to `~/bin/localcode`. Add `~/bin` to your PATH:
```bash
export PATH=$HOME/bin:$PATH
```

4. Ensure Ollama is running:
```bash
ollama serve
```

### Development Install

For development work, you can run directly from the source:
```bash
chmod +x bin/localcode
./bin/localcode
```

## Usage

### Interactive Mode

Start the interactive terminal:
```bash
localcode  # If installed via make install
# or
./bin/localcode  # If running from source
```

### Available Slash Commands

- `/models` - List available Ollama models
- `/current` - Show current model
- `/switch <model>` - Switch to a different model
- `/session new` - Start a new session
- `/session load <file>` - Load a saved session
- `/session save <file>` - Save current session
- `/help` - Show help information
- `/exit` - Exit the application

### Tool System

LocalCode includes 14 built-in tools that the AI can use:

- **bash** - Execute shell commands (requires permission)
- **read** - Read file contents
- **write** - Write content to files (requires permission)
- **edit** - Edit existing files (requires permission)
- **grep** - Search for patterns in files
- **list** - List directory contents
- **glob** - Find files matching patterns
- **patch** - Apply patches to files (requires permission)
- **webfetch** - Fetch web content
- **todowrite** - Write todo items
- **todoread** - Read todo items
- **task** - Execute complex multi-step tasks

### Permission System

Tools are classified into three categories:
- **SAFE**: Auto-approved (read, grep, list, glob, webfetch, todoread)
- **DANGEROUS**: Requires user approval (bash, write, edit, patch, task)
- **BLOCKED**: Not allowed (none by default)

## Configuration

Configuration is stored in `config/default.yaml`:

```yaml
ollama:
  host: "localhost"
  port: 11434
  default_model: "qwen2.5:32b"
  timeout: 120

ui:
  colors: true
  prompt: "LocalCode> "
  max_history: 100

permissions:
  auto_approve_safe: true
  confirm_dangerous: true
```

## Testing

Run the comprehensive test suite:
```bash
prove -v t/
```

Tests include:
- Unit tests for all modules
- Integration tests
- XML parser robustness tests
- Tool execution tests
- Permission system tests

## Development

The project follows Test-Driven Development (TDD) methodology with:

- **lib/LocalCode/Client.pm** - Ollama API client
- **lib/LocalCode/UI.pm** - Terminal interface and XML parsing
- **lib/LocalCode/Tools.pm** - Tool execution system
- **lib/LocalCode/Config.pm** - Configuration management
- **lib/LocalCode/Session.pm** - Session persistence
- **lib/LocalCode/Permissions.pm** - Permission handling

## Architecture

LocalCode is designed to be:
- **Maintainable**: Pure Perl with minimal dependencies
- **Secure**: Permission-based tool execution
- **Efficient**: Compact codebase to minimize LLM context
- **Robust**: Handles complex AI-generated content with embedded quotes
- **Local**: No cloud dependencies, works entirely with local Ollama

## License

This project is developed by Aionda GmbH.

## Contributing

1. Follow TDD methodology - write tests first
2. Maintain code style consistency
3. Ensure all tests pass before submitting
4. Keep the codebase compact and focused
