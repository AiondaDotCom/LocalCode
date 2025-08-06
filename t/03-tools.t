#!/usr/bin/env perl
use strict;
use warnings;
use Test::More tests => 38;
use File::Temp qw(tempfile tempdir);
use lib 'lib';

BEGIN { use_ok('LocalCode::Tools') }

my $tools = LocalCode::Tools->new();
ok($tools, 'Tools object created');

# Test tool registration
$tools->register_tool('read', 0, \&mock_read);  # SAFE
$tools->register_tool('write', 1, \&mock_write); # DANGEROUS
$tools->register_tool('exec', 1, \&mock_exec);   # DANGEROUS
$tools->register_tool('search', 0, \&mock_search); # SAFE

# Test tool loading
my @tool_list = $tools->list_tools();
is(scalar @tool_list, 18, 'All tools loaded'); # read, write, exec, bash, search, grep, edit, list, glob, patch, webfetch, websearch, webopen, webfind, webget, todowrite, todoread, task

# Test permission checking - now handled by Permissions module
use LocalCode::Permissions;
my $permissions = LocalCode::Permissions->new();
is($permissions->get_permission_for_tool('read'), 0, 'Read permission is SAFE');
is($permissions->get_permission_for_tool('write'), 1, 'Write permission is DANGEROUS');
is($permissions->get_permission_for_tool('exec'), 1, 'Exec permission is DANGEROUS');
is($permissions->get_permission_for_tool('search'), 0, 'Search permission is SAFE');

# Test tool validation
ok($tools->validate_tool('read'), 'Valid tool validated');
ok(!$tools->validate_tool('invalid'), 'Invalid tool rejected');

# Test safe tool execution (auto-allowed)
$tools->{test_mode} = 1;
my $result = $tools->execute_tool('read', ['/tmp/test.txt']);
ok($result->{success}, 'Safe tool executed successfully');
like($result->{output}, qr/mock read/, 'Read tool output correct');

# Test dangerous tool execution (requires permission)
$tools->{auto_approve} = 1;
$result = $tools->execute_tool('write', ['/tmp/test.txt', 'content']);
ok($result->{success}, 'Dangerous tool executed with permission');
like($result->{output}, qr/mock write/, 'Write tool output correct');

# Test permission denial - now handled at application level, not in execute_tool
# So execute_tool will succeed, but application should check permissions first
$tools->{auto_approve} = 0;
$result = $tools->execute_tool('write', ['/tmp/test.txt', 'content']);
ok($result->{success}, 'Tool executes (permission checking moved to application level)');
like($result->{message} || $result->{output} || '', qr/mock write|Wrote|written|bytes/, 'Write tool executed');

# Test tool with invalid arguments
$result = $tools->execute_tool('read', []);
ok(!$result->{success}, 'Tool with missing args fails');

# Test tool timeout
$tools->{timeout} = 1;
$result = $tools->execute_tool('exec', ['sleep 5']);
ok(!$result->{success}, 'Tool timeout handled');

# Test mock execution mode
$tools->{mock_execution} = 1;
$result = $tools->execute_tool('exec', ['ls -la']);
ok($result->{success}, 'Mock execution successful');
like($result->{output}, qr/mock exec/, 'Mock output returned');

# Test search tool
$result = $tools->execute_tool('search', ['pattern', '/tmp/test.txt']);
ok($result->{success}, 'Search tool executed');
like($result->{output}, qr/mock search/, 'Search output correct');

# Test tool with simulation mode
$tools->{simulate_only} = 1;
$result = $tools->execute_tool('write', ['/tmp/sim.txt', 'content']);
ok($result->{success}, 'Simulation mode works');
like($result->{output}, qr/\[SIMULATE\]/, 'Simulation prefix present');

# Test new tools  
my $temp_dir = tempdir(CLEANUP => 1);

# Reset mock execution for real tests
$tools->{mock_execution} = 0;
$tools->{simulate_only} = 0;

# Test glob tool
$result = $tools->execute_tool('glob', ['*.t', 't']);
ok($result->{success}, 'Glob tool executed');
like($result->{message} || '', qr/Found \d+ matches|matches/, 'Glob found matches');

# Test todowrite/todoread
$result = $tools->execute_tool('todowrite', ['Test task']);
ok($result->{success}, 'Todo write executed');
like($result->{message} || '', qr/Added task|task/, 'Todo task added');

$result = $tools->execute_tool('todoread', []);
ok($result->{success}, 'Todo read executed');
like($result->{content} || $result->{message} || '', qr/Test task|No tasks yet|todo|empty/i, 'Todo content read');

# Test webfetch in mock mode (to avoid network dependency)
$tools->{mock_execution} = 1;  # Use mock mode for webfetch
$result = $tools->execute_tool('webfetch', ['https://example.com']);
ok($result->{success}, 'Webfetch executed in mock mode');
like($result->{output} || '', qr/mock|webfetch|execute/i, 'Webfetch mock output');

# Reset for task test
$tools->{mock_execution} = 0;
# Test task tool
$result = $tools->execute_tool('task', ['echo "task test"']);
ok($result->{success}, 'Task tool executed');

# Test permissions for new tools
is($permissions->get_permission_for_tool('glob'), 0, 'Glob permission is SAFE');
is($permissions->get_permission_for_tool('webfetch'), 0, 'Webfetch permission is SAFE');
is($permissions->get_permission_for_tool('todoread'), 0, 'Todoread permission is SAFE');
is($permissions->get_permission_for_tool('todowrite'), 1, 'Todowrite permission is DANGEROUS');
is($permissions->get_permission_for_tool('patch'), 1, 'Patch permission is DANGEROUS');
is($permissions->get_permission_for_tool('task'), 1, 'Task permission is DANGEROUS');

# Mock tool functions
sub mock_read { return "mock read: $_[0]" }
sub mock_write { return "mock write: $_[0] -> $_[1]" }
sub mock_exec { return "mock exec: $_[0]" }
sub mock_search { return "mock search: $_[0] in $_[1]" }