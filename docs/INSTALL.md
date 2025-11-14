# LocalCode Installation Guide

## Prerequisites

LocalCode requires Perl 5.10+ and the following CPAN modules:

### Required Modules
```bash
cpan JSON LWP::UserAgent YAML::Tiny Test::More Getopt::Long
```

### Optional Modules (for enhanced features)
```bash
# For tab completion and emacs key bindings
cpan Term::ReadLine::Gnu

# Alternative readline implementation
cpan Term::ReadLine::Perl
```

## Installation

### 1. Clone and Setup
```bash
git clone <repository>
cd localcode
chmod +x bin/localcode
```

### 2. Install Dependencies
```bash
# Required dependencies
cpan --installdeps .

# Or manually:
cpan JSON LWP::UserAgent YAML::Tiny Test::More Getopt::Long

# Optional for enhanced CLI
cpan Term::ReadLine::Gnu
```

### 3. Test Installation
```bash
perl bin/localcode --test-connection
perl bin/localcode --health-check
```

## Features by Dependencies

### With Term::ReadLine::Gnu
- ✅ Tab completion for `/` commands
- ✅ Emacs key bindings (Ctrl+A, Ctrl+E, Ctrl+K, etc.)
- ✅ Command history with up/down arrows
- ✅ Enhanced line editing

### Without Term::ReadLine::Gnu
- ❌ No tab completion
- ✅ Basic emacs key bindings (Ctrl+A, Ctrl+E work in most terminals)
- ❌ Limited command history
- ❌ Basic line editing

## Installing Term::ReadLine::Gnu

### macOS
```bash
# Install readline first
brew install readline

# Then install the Perl module
cpan Term::ReadLine::Gnu
```

### Ubuntu/Debian
```bash
# Install development packages
sudo apt-get install libreadline-dev libncurses-dev

# Install Perl module
cpan Term::ReadLine::Gnu
```

### CentOS/RHEL
```bash
# Install development packages
sudo yum install readline-devel ncurses-devel

# Install Perl module
cpan Term::ReadLine::Gnu
```

## Troubleshooting

### "Can't locate Term/ReadLine/Gnu.pm"
This is normal - LocalCode will work without it but with limited features.
Install Term::ReadLine::Gnu for full functionality.

### CPAN installation fails
Try using your system's package manager first:
```bash
# macOS with Homebrew
brew install perl

# Ubuntu/Debian
sudo apt-get install perl libperl-dev

# Then retry CPAN installation
```

### Ollama Connection Issues
```bash
# Check if Ollama is running
curl http://localhost:11434/api/tags

# Start Ollama if needed
ollama serve

# Test connection
perl bin/localcode --test-connection
```

## Usage Examples

### Basic Usage
```bash
# Interactive mode
./bin/localcode

# Direct prompt
./bin/localcode "help me write a script"

# With auto-approval
./bin/localcode --auto-yes "create a backup script"
```

### Development/Testing
```bash
# Run all tests
make test

# Mock mode for testing
./bin/localcode --test-mode

# Health check
./bin/localcode --health-check
```