#!/usr/bin/make -f

# LocalCode Makefile - NEW STRUCTURE
# bin/    - Production-ready standalone executable
# src/    - Development files (lib/, t/, bin/localcode.original)
# build.pl - Build script to create standalone executable

.PHONY: all test test-unit test-integration dev build install clean help

# Default target - build the standalone executable
all: build

# Development mode - run tests
dev: test

# Run all tests
test: test-unit test-integration

# Run unit tests only
test-unit:
	@echo "Running unit tests..."
	prove -Isrc/lib src/t/01-client.t
	prove -Isrc/lib src/t/02-ui.t
	prove -Isrc/lib src/t/03-tools.t
	prove -Isrc/lib src/t/04-config.t
	prove -Isrc/lib src/t/05-session.t
	prove -Isrc/lib src/t/06-tui-commands.t
	prove -Isrc/lib src/t/07-model-mgmt.t
	prove -Isrc/lib src/t/08-permissions.t
	prove -Isrc/lib src/t/09-tui-automation.t
	prove -Isrc/lib src/t/10-http.t
	prove -Isrc/lib src/t/11-json.t
	prove -Isrc/lib src/t/12-yaml.t

# Run integration tests
test-integration:
	@echo "Running integration tests..."
	prove -Isrc/lib src/t/99-integration.t

# Test specific module
test-module:
	@if [ -z "$(MODULE)" ]; then echo "Usage: make test-module MODULE=client"; exit 1; fi
	prove -Isrc/lib src/t/*$(MODULE)*.t

# Run tests with verbose output
test-verbose:
	prove -Isrc/lib -lv src/t/

# Test TUI automation specifically
test-tui:
	@echo "Testing TUI automation..."
	prove -Isrc/lib src/t/06-tui-commands.t src/t/09-tui-automation.t

# Build standalone executable from source modules
build:
	@echo "Building standalone executable..."
	@cd src && perl build.pl
	@rm -f src/bin/localcode.template  # Clean up old template
	@echo "✅ Build complete: localcode"

# Test the built executable
test-dist: build
	@echo "Testing built executable..."
	./localcode --version
	./localcode --help | head -10

# Install to ~/bin/localcode
install: build
	@echo "Installing localcode to ~/bin/localcode..."
	@mkdir -p ~/bin
	@cp localcode ~/bin/localcode
	@chmod +x ~/bin/localcode
	@echo "✅ Installed to ~/bin/localcode"
	@echo "💡 Add ~/bin to your PATH if not already: export PATH=\$$PATH:\$$HOME/bin"

# Install to /usr/local/bin (system-wide, requires sudo)
install-system: build
	@echo "Installing localcode to /usr/local/bin/localcode (system-wide)..."
	@sudo cp localcode /usr/local/bin/localcode
	@sudo chmod +x /usr/local/bin/localcode
	@echo "✅ Installed to /usr/local/bin/localcode"

# Clean up generated files
clean:
	@echo "Cleaning generated files..."
	@rm -f localcode
	@rm -rf src/t/tmp_*
	@echo "✅ Clean complete"

# Clean all including build artifacts
distclean: clean
	@echo "Cleaning all build artifacts..."
	@rm -f src/bin/localcode.template
	@rm -rf ~/.localcode/sessions/test_*
	@echo "✅ Distclean complete"

# Show project structure
tree:
	@echo "Project Structure:"
	@echo "bin/              - Standalone executable (git-ignored)"
	@echo "src/              - Development source"
	@echo "  src/lib/        - Perl modules"
	@echo "  src/t/          - Test suite"
	@echo "  src/bin/        - Original main script template"
	@echo "build.pl          - Build script"
	@echo "Makefile          - This file"
	@echo ""
	@echo "Usage: Clone repo → make build → ./bin/localcode"

# Show test coverage
coverage:
	@echo "Test Coverage:"
	@echo "  Unit tests: 9 modules, ~310 test cases"
	@echo "  Integration tests: 40 test cases"
	@echo "  TUI automation: 30+ command scenarios"
	@echo ""
	@echo "Run: make test"

# Help
help:
	@echo "LocalCode Build System"
	@echo ""
	@echo "Quick Start:"
	@echo "  make build        - Build standalone executable in bin/"
	@echo "  ./bin/localcode   - Run the executable"
	@echo ""
	@echo "Available targets:"
	@echo "  all               - Build standalone executable (default)"
	@echo "  build             - Build bin/localcode from src/"
	@echo "  test              - Run all tests"
	@echo "  test-unit         - Run unit tests only"
	@echo "  test-tui          - Run TUI automation tests"
	@echo "  test-module       - Test specific module (MODULE=name)"
	@echo "  test-dist         - Test built executable"
	@echo "  install           - Build and install to ~/bin/localcode"
	@echo "  install-system    - Build and install to /usr/local/bin/ (sudo)"
	@echo "  clean             - Remove generated files"
	@echo "  distclean         - Remove all build artifacts"
	@echo "  tree              - Show project structure"
	@echo "  coverage          - Show test coverage info"
	@echo "  help              - Show this help"
	@echo ""
	@echo "Development:"
	@echo "  make dev          - Run all tests"
	@echo "  make test-verbose - Run tests with verbose output"
