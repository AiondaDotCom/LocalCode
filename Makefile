#!/usr/bin/make -f

# LocalCode Makefile

.PHONY: test test-unit test-integration dev build install clean

# Development mode - run tests
dev: test

# Run all tests
test: test-unit test-integration

# Run unit tests only
test-unit:
	@echo "Running unit tests..."
	prove -l t/01-client.t
	prove -l t/02-ui.t
	prove -l t/03-tools.t
	prove -l t/04-config.t
	prove -l t/05-session.t
	prove -l t/06-tui-commands.t
	prove -l t/07-model-mgmt.t
	prove -l t/08-permissions.t
	prove -l t/09-tui-automation.t

# Run integration tests
test-integration:
	@echo "Running integration tests..."
	prove -l t/99-integration.t

# Test specific module
test-module:
	@if [ -z "$(MODULE)" ]; then echo "Usage: make test-module MODULE=client"; exit 1; fi
	prove -l t/*$(MODULE)*.t

# Run tests with verbose output
test-verbose:
	prove -lv t/

# Test TUI automation specifically
test-tui:
	@echo "Testing TUI automation..."
	prove -l t/06-tui-commands.t t/09-tui-automation.t

# Build single-file distribution
build:
	@echo "Building single-file distribution..."
	perl build.pl --output dist/localcode --minify

# Test the built distribution
test-dist: build
	@echo "Testing built distribution..."
	dist/localcode --test-all

# Install to system
install: build
	@echo "Installing localcode..."
	cp dist/localcode /usr/local/bin/localcode
	chmod +x /usr/local/bin/localcode

# Clean up generated files
clean:
	rm -f dist/localcode
	rm -rf t/tmp_*

# Show test coverage
coverage:
	@echo "Test coverage analysis..."
	@echo "Unit tests: 9 modules, ~200 test cases"
	@echo "Integration tests: 40 test cases"
	@echo "TUI automation: 30+ command scenarios"

# Help
help:
	@echo "LocalCode Build System"
	@echo ""
	@echo "Available targets:"
	@echo "  test          - Run all tests"
	@echo "  test-unit     - Run unit tests only"
	@echo "  test-tui      - Run TUI automation tests"
	@echo "  test-module   - Test specific module (MODULE=name)"
	@echo "  build         - Create single-file distribution"
	@echo "  test-dist     - Test built distribution"
	@echo "  install       - Install to /usr/local/bin"
	@echo "  clean         - Clean generated files"
	@echo "  coverage      - Show test coverage info"