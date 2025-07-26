# LocalCode - Perl-based Ollama AI Coding Agent

## Project Overview

A minimal, efficient Terminal UI coding agent written in Perl that works exclusively with Ollama for local AI assistance. Designed for maximum code density and autonomous LLM testing.

## Architecture

### Core Components

```
localcode/
├── lib/
│   ├── LocalCode/
│   │   ├── Client.pm          # Ollama API client
│   │   ├── UI.pm             # Terminal interface + prompt injection
│   │   ├── Tools.pm          # Tool system + permissions
│   │   ├── Config.pm         # Configuration
│   │   ├── Permissions.pm    # Permission management
│   │   └── Session.pm        # Chat session management
├── bin/
│   └── localcode             # Development launcher
├── build.pl                  # Build script (creates single file)
├── Makefile                  # Build automation
├── t/                        # Unit tests
├── tools/                    # Tool definitions
├── config/                   # Default configurations + permissions
└── dist/
    └── localcode             # Generated single-file executable
```

### Key Design Principles

1. **Minimal Dependencies**: Only essential CPAN modules
2. **CLI-First**: Everything testable via command line
3. **Tool-Driven**: Extensible tool system for code generation
4. **Local-Only**: No cloud dependencies, Ollama exclusive
5. **Context-Efficient**: Minimal code footprint

## Technical Stack

### Core Perl Modules
- `JSON` - API communication with Ollama
- `LWP::UserAgent` - HTTP client
- `Term::ReadKey` - Terminal control
- `Getopt::Long` - CLI argument parsing
- `File::Slurp` - File operations
- `Test::More` - Unit testing

### Optional Enhancement Modules
- `Term::ANSIColor` - Colored output
- `Text::Wrap` - Text formatting
- `YAML::Tiny` - Configuration files

## Core Features

### 1. Ollama Integration (`lib/LocalCode/Client.pm`)

```perl
# Key methods:
- connect()           # Connect to Ollama instance
- chat($prompt)       # Send chat request
- list_models()       # Available models
- generate($prompt)   # Code generation
- stream_response()   # Streaming responses
```

**CLI Testing Interface:**
```bash
localcode --test-connection
localcode --list-models
localcode --chat "Hello test"
```

### 2. Terminal UI (`lib/LocalCode/UI.pm`)

```perl
# Minimal TUI features:
- prompt_user()       # Interactive prompts
- display_response()  # Format AI responses
- show_progress()     # Progress indicators
- handle_input()      # Key event handling
- inject_system_prompt() # Inject tool instructions
- parse_tool_calls()  # Parse LLM tool requests
- show_permission_dialog() # Permission UI
```

**System Prompt Injection:**
Before each user prompt, inject minimal tool instructions:
```
Tools: read(file), write(file,content), exec(cmd), search(pattern,file)
Safe: read,search | Dangerous: write,exec 
Use: read("/path/file") write("/path/file","content") exec("command") search("text","file")
```

**Response Parsing:**
- Detect tool calls in LLM responses
- Extract parameters 
- Check permissions
- Show confirmation dialog for DANGEROUS tools

**CLI Testing Interface:**
```bash
localcode --ui-test
localcode --batch-mode < input.txt
localcode --test-prompt-injection
```

### 3. Tool System (`lib/LocalCode/Tools.pm`)

```perl
# Tool management:
- load_tools()        # Load available tools
- execute_tool()      # Run tool with parameters
- register_tool()     # Add new tool
- validate_tool()     # Tool validation
- check_permission()  # Permission validation
- request_permission()# Request user permission
```

**Built-in Tools with Permission Levels:**
- `file_read` - Read files (SAFE - auto-allowed)
- `grep_search` - Search in files (SAFE - auto-allowed)
- `file_write` - Write files (DANGEROUS - requires permission)
- `shell_exec` - Execute commands (DANGEROUS - requires permission)
- `file_delete` - Delete files (DANGEROUS - requires permission)

**Permission Management:**
```perl
# Permission levels:
SAFE      = 0  # Auto-allowed (read operations)
DANGEROUS = 1  # Requires user confirmation
BLOCKED   = 2  # Never allowed
```

**CLI Testing Interface:**
```bash
localcode --tool file_read --file test.pl
localcode --tool shell_exec --cmd "perl -c script.pl" --force
localcode --list-tools
localcode --permissions-test

# Permission override for testing:
localcode --auto-yes "write hello into hello.txt"
localcode --auto-no "delete important.txt" 
localcode --simulate "create backup script"  # dry-run mode
```

### 4. Session Management (`lib/LocalCode/Session.pm`)

```perl
# Session handling:
- new_session()       # Create session
- save_session()      # Persist session
- load_session()      # Restore session
- session_history()   # Chat history
```

**CLI Testing Interface:**
```bash
localcode --new-session test_session
localcode --load-session test_session
localcode --session-history
```

## Configuration System

### Default Config (`config/default.yaml`)
```yaml
ollama:
  host: "localhost"
  port: 11434
  model: "codellama"
  timeout: 30

ui:
  colors: true
  streaming: true
  history_size: 100
  prompt_injection: true

tools:
  enabled: ["file_read", "file_write", "shell_exec", "grep_search"]
  timeout: 60

permissions:
  safe_auto_allow: ["file_read", "grep_search"]
  dangerous_confirm: ["file_write", "shell_exec", "file_delete"]
  blocked: []
  remember_choice: true
  
testing:
  auto_approve: false     # For --auto-yes mode
  auto_deny: false       # For --auto-no mode
  simulate_only: false   # For --simulate mode
  mock_execution: false  # For --test-mode
```

### Permission Dialog Example
```
[PERMISSION REQUIRED]
Tool: file_write(script.pl, "#!/usr/bin/perl...")
Risk: DANGEROUS - Will create/modify files
Allow? [y/N/a=always]: 
```

### CLI Testing Modes for LLM
```bash
# LLM can test with automatic permission handling:
localcode --auto-yes "write hello into hello.txt"
# Output: [AUTO-APPROVED] write("/tmp/hello.txt","hello")
#         File written successfully.

localcode --auto-no "delete config.yaml"  
# Output: [AUTO-DENIED] exec("rm config.yaml")
#         Permission denied by testing mode.

localcode --simulate "create backup of data.txt"
# Output: [SIMULATE] read("/tmp/data.txt") -> OK
#         [SIMULATE] write("/tmp/data.txt.bak", content) -> Would create file
#         Simulation completed without actual execution.

localcode --test-mode "run tests"
# Output: [MOCK] exec("perl -T test.pl") -> Simulated success
#         Mock execution completed.
```

### Compact System Prompt (3 lines vs OpenCode's 10 lines)
```
Tools: read(file), write(file,content), exec(cmd), search(pattern,file)
Safe: read,search | Dangerous: write,exec 
Use: read("/path/file") write("/path/file","content") exec("command") search("text","file")
```

**CLI Testing Interface:**
```bash
localcode --config-test
localcode --set-model llama2
localcode --show-config
```

## Testing Strategy

### Unit Tests (`t/`)

```
t/
├── 01-client.t       # Ollama client tests
├── 02-ui.t          # UI component tests  
├── 03-tools.t       # Tool system tests
├── 04-config.t      # Configuration tests
├── 05-session.t     # Session management tests
└── 99-integration.t # End-to-end tests
```

### Test Requirements
- **Mock Ollama**: Tests run without real Ollama instance
- **CLI Coverage**: Every feature testable via CLI
- **Error Handling**: All failure modes covered
- **Performance**: Response time validation

### Autonomous Testing Interface

```bash
# LLM can run these commands for testing:
localcode --self-test              # Run all tests
localcode --test-module Client     # Test specific module
localcode --validate-tools         # Check tool definitions
localcode --health-check          # System health
```

## Implementation Phases

### Phase 1: Core Infrastructure (MVP)
- [ ] Basic Ollama client
- [ ] Simple CLI interface
- [ ] File read/write tools
- [ ] Basic configuration
- [ ] Unit test framework

### Phase 2: Enhanced UI
- [ ] Interactive terminal UI
- [ ] Streaming responses
- [ ] Session management
- [ ] History persistence

### Phase 3: Advanced Tools
- [ ] Shell execution tool
- [ ] Search/grep tool
- [ ] Test execution tool
- [ ] Tool plugin system

### Phase 4: Polish & Testing
- [ ] Comprehensive test suite
- [ ] Error handling
- [ ] Documentation
- [ ] Performance optimization

## CLI Command Reference

### Basic Usage
```bash
localcode                         # Interactive mode
localcode "Generate hello world"  # Direct prompt
localcode --file script.pl        # Process file
```

### Testing Commands (for LLM autonomous testing)
```bash
localcode --test-all              # Complete test suite
localcode --test-connection       # Test Ollama connection
localcode --validate-config       # Check configuration
localcode --tool-test <tool>      # Test specific tool
localcode --dry-run <command>     # Simulate without execution

# Permission control for autonomous testing:
localcode --auto-yes <prompt>     # Auto-approve all permissions
localcode --auto-no <prompt>      # Auto-deny all permissions  
localcode --simulate <prompt>     # Dry-run mode (no actual execution)
localcode --test-mode <prompt>    # Special testing mode with mock execution
```

### Session Commands
```bash
localcode --new-session <name>    # Create session
localcode --list-sessions         # Show all sessions
localcode --delete-session <name> # Remove session
```

### Configuration Commands
```bash
localcode --setup                 # Initial setup wizard
localcode --config-edit           # Edit configuration
localcode --reset-config          # Reset to defaults
```

## File Structure Example

### Main Executable (`bin/localcode`)
```perl
#!/usr/bin/env perl
use strict; use warnings;
use lib 'lib';
use LocalCode::UI;
use LocalCode::Config;
use Getopt::Long;

# Minimal main entry point - ~50 lines
```

### Core Modules (~100-150 lines each)
- Focus on essential functionality only
- Heavy use of Perl's built-in features
- Minimal external dependencies
- Dense, idiomatic Perl code

## Success Metrics

1. **Code Efficiency**: <1000 total lines of Perl code
2. **Startup Time**: <2 seconds from launch to ready
3. **Memory Usage**: <50MB runtime footprint  
4. **Test Coverage**: >90% code coverage
5. **CLI Testability**: 100% features testable via CLI
6. **Ollama Integration**: Seamless local model interaction

## Build System

### Single-File Distribution
```bash
# Build process creates standalone executable:
make build
# Generates: dist/localcode (single 5-10KB Perl file)

# Build script combines all modules:
perl build.pl --output dist/localcode --minify
```

### Build Process (`build.pl`)
```perl
# Combines all lib/*.pm files into single executable
# Minifies code (removes comments, extra whitespace)  
# Embeds default config as __DATA__ section
# Creates shebang with dependencies check
# Output: Single portable Perl file
```

### Distribution Structure
```
# Development (modular):
lib/LocalCode/*.pm     # 6 modules × ~150 lines = ~900 lines
config/default.yaml    # Configuration

# Distribution (monolithic):  
dist/localcode         # Single file ~1000 lines total
```

### Advantages
- **Deployment**: Single file copy/install
- **Dependencies**: Self-contained (except CPAN modules)
- **Distribution**: Easy sharing/downloading
- **Maintenance**: Develop modular, ship monolithic

## Development Workflow

1. **Modular Development**: Write/test in separate modules
2. **Build Process**: Combine into single file for distribution  
3. **Test-Driven**: Write tests first for each component
4. **CLI-Testable**: Every feature must have CLI testing interface
5. **Minimal**: Favor Perl idioms over external libraries
6. **Local-First**: No network dependencies except Ollama
7. **LLM-Friendly**: Architecture designed for autonomous LLM interaction

### Build Commands
```bash
make dev          # Development mode (uses lib/ modules)
make build        # Create single-file distribution
make test         # Run tests on modular version
make test-dist    # Run tests on built distribution
make install      # Install to /usr/local/bin/localcode
```

This blueprint provides a foundation for building a highly efficient, testable, and maintainable Perl-based AI coding agent that works exclusively with local Ollama instances and ships as a single portable file.