# Execution Permission Checking Feature

## Overview

LocalCode now automatically checks file execution permissions before attempting to run commands. When a script lacks execute permissions, the AI receives a detailed English error message explaining the issue and suggesting fixes.

## How It Works

When the `bash` or `exec` tool is called with a command that references a local file, LocalCode:

1. **Parses the command** to identify the file being executed
2. **Checks if the file exists** and whether it has execute permissions
3. **Reports detailed permission information** if execution would fail

## Supported Command Patterns

The permission checker recognizes these patterns:

- `./script.pl` - Relative path execution
- `/absolute/path/to/script.sh` - Absolute path
- `path/to/script.py` - Relative path with directory
- `perl script.pl` - Interpreter with script
- `python3 /path/to/script.py` - Interpreter with full path

## Error Message Format

When a file lacks execute permission, the AI receives:

```
EXECUTION DENIED: File './script.pl' does not have execute permission.

Current permissions: rw-r--r-- (0644 in octal)
File owner: username (uid: 501)
File group: staff (gid: 20)
Current user: username (uid: 501)

To fix this, you need to add execute permission. Suggested fix:
  chmod +x ./script.pl

Alternative: Run the file with an interpreter:
  perl ./script.pl
```

## Intelligent Interpreter Suggestions

The system suggests appropriate interpreters based on:

1. **File extension**: `.pl` → perl, `.py` → python, `.sh` → bash, etc.
2. **Shebang line**: Reads `#!/usr/bin/perl` and suggests `perl script.pl`
3. **Generic fallback**: Suggests bash or appropriate interpreter

## Example Interaction

```bash
User: "Run ./calculate.pl"
AI: <tool_call name="bash" args={"command": "./calculate.pl"}>

LocalCode checks permissions → File is not executable

AI receives: "EXECUTION DENIED: File './calculate.pl' does not have
execute permission... Suggested fix: chmod +x ./calculate.pl"

AI responds: "The script lacks execute permission. I'll fix this..."
AI: <tool_call name="bash" args={"command": "chmod +x ./calculate.pl"}>
AI: <tool_call name="bash" args={"command": "./calculate.pl"}>
```

## Benefits

1. **Proactive error detection**: Catches permission issues before execution
2. **Educational**: Teaches users about Unix file permissions
3. **Actionable suggestions**: Provides exact commands to fix the issue
4. **Context-aware**: Suggests appropriate interpreters based on file type
5. **Security-conscious**: Reports current user context and ownership

## Testing

Comprehensive test coverage in `src/t/09-exec-permissions.t`:

- Detects missing execute permissions
- Reports detailed permission information
- Suggests appropriate fixes
- Handles various command patterns
- Verifies successful execution after permissions are fixed

All 13 permission checking tests pass successfully.

## Implementation

Location: `src/lib/LocalCode/Tools.pm`, function `_tool_exec`

The permission check runs BEFORE attempting to execute the command, preventing confusing error messages from the shell and providing clearer, more actionable feedback to the AI.
