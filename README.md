# LocalCode

A compact, Perl-based AI coding agent with browser tools and gpt-oss support that provides an interactive terminal interface for AI-assisted programming tasks using local Ollama models.

![LocalCode in Action](example.png)

*LocalCode executing multiple tool calls in sequence: creating a Perl calculator, making it executable, and testing it - all from a single AI prompt.*

## Features

### Core Features
- **Local AI Models**: Works with Ollama including gpt-oss models with thinking field support
- **Interactive Terminal UI**: Command-line interface with readline, cursor key navigation, and TAB completion
- **Multiple Tool Execution**: AI can execute multiple tools in sequence for complete workflows
- **Intelligent Follow-up**: AI analyzes tool results and automatically executes additional tool calls
- **Tool Execution**: Secure permission-based system for running AI-requested tools
- **Version Display**: Shows LocalCode v1.0.0 on startup with `--version` flag

### Browser Integration
- **Web Search**: DuckDuckGo integration with `websearch(query)` tool  
- **Web Navigation**: Open webpages with `webopen(url_or_id)` tool
- **Content Search**: Find text within webpages using `webfind(pattern)` tool
- **Quick Web Access**: Combined search+open with `webget(query)` tool
- **SSL Bypass**: Reliable web connectivity with certificate bypass

### Enhanced Session Management
- **Persistent Storage**: All data stored in ~/.localcode directory
- **Model Persistence**: Last selected model saved and restored on restart
- **Unified History**: Chat conversation and command history merged
- **Command History**: Cursor key navigation with Term::ReadLine persistence

### Advanced Tool System
- **18 Built-in Tools**: Including browser tools (websearch, webopen, webfind, webget)
- **Smart Tool Parsing**: Robust XML parser with validation for required arguments
- **Follow-up Execution**: Tool calls in AI follow-up responses are automatically parsed and executed
- **Smart Autocompletion**: Tab completion for commands and model names with trimming
- **Enhanced gpt-oss Support**: Optimized prompting and response handling for thinking field models

### Technical Excellence
- **Test-Driven Development**: 316+ comprehensive tests ensuring reliability
- **Ultra-Compact**: ~1000 lines of Perl code for minimal LLM context usage
- **Smart Context Management**: Automatic history truncation when context limits exceeded
- **Robust Error Handling**: AI can analyze tool failures and suggest fixes automatically

## Requirements

- Perl 5.10+
- Ollama running locally (supports gpt-oss models)
- Term::ReadLine::Gnu (for readline and command history)
- YAML::Tiny (for configuration)
- JSON (for session management and API communication)
- LWP::UserAgent (for Ollama API communication)
- curl (for modern SSL-compatible web tools)
- URI::Escape (for web search URL encoding)
- File::Spec, File::Path (for file operations and ~/.localcode management)

## Installation

### Quick Install (Recommended)

1. Clone the repository:
```bash
git clone <repository-url>
cd localcode
```

2. Install Perl dependencies:
```bash
cpan YAML::Tiny JSON LWP::UserAgent URI::Escape Term::ReadLine::Gnu File::Path
```

3. Build and install:
```bash
make install
```

This creates a single-file distribution and installs it to `~/bin/localcode`. Add `~/bin` to your PATH:
```bash
export PATH=$PATH:$HOME/bin
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
- `/model <name>` - Switch to a different model (with Tab completion)
- `/current` - Show current model
- `/tools` - List available tools
- `/permissions` - Show permission settings
- `/save <name>` - Save current session
- `/load <name>` - Load saved session
- `/sessions` - List saved sessions
- `/history` - Show unified chat and command history
- `/version` - Show LocalCode version
- `/clear` - Clear current session
- `/help` - Show help information
- `/exit` - Exit the application

### Enhanced Tool System

LocalCode includes 18 built-in tools that the AI can use:

#### File Operations
- **read** - Read file contents
- **write** - Write content to files (requires permission)
- **edit** - Edit existing files (requires permission)
- **list** - List directory contents
- **glob** - Find files matching patterns
- **patch** - Apply patches to files (requires permission)

#### System Operations
- **bash/exec** - Execute shell commands (requires permission)
- **search/grep** - Search for patterns in files
- **task** - Execute complex multi-step tasks (requires permission)

#### Browser Tools
- **websearch** - Search the web using DuckDuckGo
- **webopen** - Open webpages or search results by ID
- **webfind** - Search for text within opened webpages
- **webget** - Combined search and open in one step
- **webfetch** - Fetch web content directly

#### Productivity Tools
- **todowrite** - Write todo items
- **todoread** - Read todo items

### Permission System

Tools are classified into three categories:
- **SAFE**: Auto-approved (read, grep, list, glob, webfetch, websearch, webopen, webfind, webget, todoread)
- **DANGEROUS**: Requires user approval (bash, write, edit, patch, task, todowrite)
- **BLOCKED**: Not allowed (none by default)

### CLI Usage

```bash
# Interactive mode
localcode

# Direct commands
localcode "search the web for Perl tutorials"
localcode "read config.yaml and show me the settings"

# Model management
localcode --list-models
localcode --set-model gpt-oss:20b
localcode --current-model

# Version and help
localcode --version
localcode --help

# Testing modes
localcode --auto-yes "write hello to test.txt"
localcode --simulate "dangerous command"
localcode --test-mode "mock execution"
```

## Intelligent AI Workflows

LocalCode's enhanced AI system provides intelligent multi-step execution:

### Follow-up Tool Execution
When tool execution results are returned to the AI, LocalCode automatically:
1. **Analyzes Results**: AI reviews tool outputs, errors, and success status
2. **Intelligent Response**: AI generates follow-up actions based on results  
3. **Automatic Execution**: Tool calls in follow-up responses are parsed and executed
4. **Error Recovery**: AI suggests fixes when tools fail (e.g., missing includes in C programs)

### Example Workflow
```bash
User: "Create a C program that adds two numbers"
AI: Creates add.c with write tool
System: Executes write tool, reports success
AI: Compiles program with gcc
System: Reports compilation error (missing #include <stdlib.h>)
AI: Analyzes error, suggests fix, updates code automatically
System: Executes edit and compile tools
AI: Tests the final program with sample input
```

### gpt-oss Model Support
Special optimizations for thinking field models:
- **Thinking Display**: Shows AI reasoning process during analysis
- **Optimized Prompting**: Clear instructions for tool call placement
- **Enhanced Parsing**: Robust handling of thinking + response structure
- **Context Management**: Efficient conversation flow with thinking content

## Configuration

Configuration is stored in `config/default.yaml`:

```yaml
ollama:
  host: "localhost"
  port: 11434
  default_model: "codellama:latest"
  current_model: null  # Auto-detect and persist

permissions:
  safe_auto_allow: ["file_read", "grep_search", "websearch", "webopen", "webfind", "webget"]
  dangerous_confirm: ["file_write", "shell_exec"]
  
testing:
  auto_approve: false  # For --auto-yes mode
  simulate_only: false # For --simulate mode
```

### Persistent Storage

LocalCode stores all persistent data in `~/.localcode/`:

```
~/.localcode/
├── sessions/              # Saved chat sessions
├── last_model.txt         # Last selected model
└── command_history        # Readline command history
```

## Testing

Run the comprehensive test suite:
```bash
make test              # All tests
prove -l t/04-config.t # Specific module
make test-verbose      # Detailed output
```

### Advanced Testing
```bash
# Test web search functionality
localcode --test-mode "websearch Stuttgart"
localcode --test-mode "webget current weather Berlin"
localcode --test-mode "webopen https://example.com"
localcode --test-mode "webfind hello"

# Test gpt-oss models with follow-up execution
localcode --set-model "gpt-oss:20b"
localcode --auto-yes "erstelle ein C-Programm das zwei Zahlen addiert"

# Test robust tool parsing
localcode --test-mode "create a complex script with multiple steps"
```

Tests include:
- Unit tests for all modules (316+ tests)
- Browser tools integration tests
- gpt-oss thinking field validation and follow-up execution
- XML tool call parser robustness tests
- Follow-up tool execution validation
- Tool argument validation tests
- Model persistence and trimming tests
- Readline history functionality
- SSL certificate bypass validation
- Permission system tests

## Development

The project follows Test-Driven Development (TDD) methodology with:

- **lib/LocalCode/Config.pm** - YAML configuration with ~/.localcode persistence
- **lib/LocalCode/Permissions.pm** - SAFE/DANGEROUS/BLOCKED tool classification
- **lib/LocalCode/Session.pm** - JSON session persistence with unified history
- **lib/LocalCode/Client.pm** - Ollama API client with gpt-oss thinking field support
- **lib/LocalCode/Tools.pm** - Tool execution system with browser integration
- **lib/LocalCode/UI.pm** - Terminal interface with readline and autocompletion
- **bin/localcode** - Main executable with version display (v1.0.0)

## Architecture

LocalCode is designed to be:
- **Maintainable**: Pure Perl with minimal dependencies
- **Secure**: Permission-based tool execution with SSL bypass for web tools
- **Efficient**: Compact codebase (~1000 lines) to minimize LLM context
- **Robust**: Handles complex AI-generated content with embedded quotes and incomplete tool calls
- **Local-First**: Works with local Ollama while providing web search capabilities
- **User-Friendly**: Tab completion, cursor key navigation, persistent history
- **AI-Enhanced**: Optimized gpt-oss support with thinking field display and follow-up execution
- **Intelligent**: AI analyzes tool failures and automatically suggests fixes
- **Extensible**: Easy-to-add new tools while maintaining security model

## License

This project is developed by Aionda GmbH.

## Contributing

1. Follow TDD methodology - write tests first
2. Maintain code style consistency
3. Ensure all tests pass before submitting
4. Keep the codebase compact and focused
