# LocalCode Development Guide

## Project Overview

LocalCode is a Perl-based AI coding agent designed exclusively for Ollama. Built with Test-Driven Development for maximum reliability and autonomous testing.

## Prerequisites

### Required Software
- **Perl 5.34+** (with core modules)
- **Ollama** (for production use)
- **make** (for build automation)

### Required CPAN Modules
```bash
# Install dependencies
cpan JSON LWP::UserAgent YAML::Tiny Test::More File::Temp Getopt::Long
```

### Optional for Development
- **prove** (usually included with Perl)
- **perltidy** (code formatting)

## Quick Start

### 1. Clone and Setup
```bash
git clone <repository-url>
cd localcode
```

### 2. Verify Installation
```bash
# Check Perl syntax
perl -c bin/localcode

# Run self-test
bin/localcode --test-mode --self-test
```

### 3. Start LocalCode
```bash
# Interactive mode (requires Ollama)
bin/localcode

# Mock mode for testing
bin/localcode --test-mode
```

## Development Workflow

### Running Tests

#### All Tests
```bash
make test                    # Run complete test suite
make test-verbose           # Detailed test output
```

#### Individual Test Files
```bash
prove -l t/01-client.t      # Client tests
prove -l t/02-ui.t          # UI tests
prove -l t/03-tools.t       # Tools tests
prove -l t/04-config.t      # Config tests
prove -l t/05-session.t     # Session tests
prove -l t/06-tui-commands.t # TUI commands
prove -l t/07-model-mgmt.t  # Model management
prove -l t/08-permissions.t # Permissions
prove -l t/09-tui-automation.t # TUI automation
prove -l t/99-integration.t # Integration tests
```

#### Specific Test Categories
```bash
make test-unit              # Unit tests only
make test-integration       # Integration tests only
make test-tui              # TUI-specific tests
```

### Testing Modes

#### Mock Testing (No Ollama Required)
```bash
bin/localcode --test-mode --list-models
bin/localcode --test-mode --validate-tools
bin/localcode --test-mode --health-check
```

#### Permission Testing
```bash
bin/localcode --auto-yes "write hello into test.txt"
bin/localcode --auto-no "delete important.txt"
bin/localcode --simulate "dangerous command"
```

#### TUI Automation Testing
```bash
# Test via stdin
echo "/models\n/current\n/help\n/exit" | bin/localcode --test-mode --test-tui-stdin

# Test via script file
bin/localcode --test-mode --test-tui-script test_commands.txt
```

## Code Structure

### Core Modules (`lib/LocalCode/`)
```
Client.pm      # Ollama API integration + model management
Config.pm      # YAML configuration with boolean conversion  
Permissions.pm # SAFE/DANGEROUS/BLOCKED tool classification
Session.pm     # JSON session persistence with history limits
Tools.pm       # Tool execution with permission integration
UI.pm          # TUI + slash commands + prompt injection
```

### Main Executable (`bin/localcode`)
- CLI argument parsing
- Component initialization
- Interactive TUI mode
- Direct prompt mode
- Testing interfaces

### Tests (`t/`)
- **240 tests total** across 10 test files
- 100% pass rate
- Mock modes for external dependencies
- Comprehensive TUI automation

## Configuration

### Default Config (`config/default.yaml`)
```yaml
ollama:
  host: "localhost" 
  port: 11434
  default_model: "llama3"
  current_model: null  # Auto-detect

permissions:
  safe_auto_allow: ["file_read", "grep_search"]
  dangerous_confirm: ["file_write", "shell_exec"]
  
testing:
  auto_approve: false
  simulate_only: false
```

## Usage Examples

### Interactive Mode
```bash
# Start interactive TUI
bin/localcode

# Available commands in TUI:
localcode> /models           # List available models
localcode> /model llama2     # Switch to llama2  
localcode> /current          # Show current model
localcode> /tools            # List available tools
localcode> /help             # Show all commands
localcode> /exit             # Exit program
```

### Direct Prompt Mode
```bash
# Single prompt execution
bin/localcode "write a hello world script"

# With permission control
bin/localcode --auto-yes "create backup script"
bin/localcode --simulate "delete old files"
```

### Testing Commands
```bash
# System validation
bin/localcode --test-connection    # Test Ollama connection
bin/localcode --health-check      # Complete system check
bin/localcode --config-test       # Validate configuration

# Tool validation  
bin/localcode --validate-tools    # Check all tools
bin/localcode --list-models       # Show available models
bin/localcode --current-model     # Show active model
```

## Development Commands

### Syntax Checking
```bash
# Check all modules
perl -c lib/LocalCode/*.pm

# Check main executable
perl -c bin/localcode

# Check specific module
perl -c lib/LocalCode/UI.pm
```

### Code Quality
```bash
# Run perltidy (if installed)
perltidy -b lib/LocalCode/*.pm

# Check for common issues
perl -MO=Lint lib/LocalCode/Client.pm
```

### Performance Testing
```bash
# Measure startup time
time bin/localcode --test-mode --help

# Memory usage
/usr/bin/time -v bin/localcode --test-mode --self-test
```

## Debugging

### Enable Verbose Output
```bash
# Detailed test output
prove -lv t/01-client.t

# Debug specific test
perl -d t/01-client.t
```

### Common Issues

#### Missing Dependencies
```bash
# Install missing CPAN modules
cpan JSON LWP::UserAgent YAML::Tiny
```

#### Ollama Connection Issues
```bash
# Test connection
bin/localcode --test-connection

# Use mock mode
bin/localcode --test-mode
```

#### Permission Errors
```bash
# Test with auto-approval
bin/localcode --auto-yes "test command"

# Use simulation mode  
bin/localcode --simulate "potentially dangerous command"
```

## Test-Driven Development

### Adding New Features

1. **Write Tests First**
```bash
# Create new test file
cp t/01-client.t t/10-newfeature.t
# Edit test file with new functionality tests
```

2. **Run Tests (Should Fail)**
```bash
prove -l t/10-newfeature.t
```

3. **Implement Feature**
```bash
# Add code to appropriate module
vim lib/LocalCode/NewFeature.pm
```

4. **Run Tests (Should Pass)**
```bash
prove -l t/10-newfeature.t
```

5. **Integration Testing**
```bash
make test
```

### Test Categories

- **Unit Tests**: Individual module functionality
- **Integration Tests**: Component interaction 
- **TUI Tests**: User interface automation
- **Mock Tests**: External dependency simulation

## Build System

### Available Targets
```bash
make dev          # Development mode
make test         # Run all tests
make test-unit    # Unit tests only
make test-tui     # TUI tests only
make clean        # Clean temporary files
make help         # Show all targets
```

### Manual Test Execution
```bash
# Individual test runner
prove -l t/

# With coverage (if Devel::Cover installed)
prove -l t/ -MDevel::Cover

# Parallel testing
prove -l -j4 t/
```

## Contributing

### Code Style
- Follow existing Perl conventions
- Keep modules under 200 lines each
- Write tests before implementation
- Use descriptive variable names
- Add comments for complex logic

### Pull Request Process
1. Create feature branch
2. Write tests for new functionality  
3. Implement feature
4. Ensure all tests pass
5. Update documentation
6. Submit pull request

### Testing Requirements
- All new code must have tests
- Tests must pass in both real and mock modes
- TUI features need automation tests
- Integration tests for new components

This development guide covers everything needed to work with LocalCode effectively, from initial setup to advanced testing and debugging.