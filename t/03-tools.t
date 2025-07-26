#!/usr/bin/env perl
use strict;
use warnings;
use Test::More tests => 23;
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
is(scalar @tool_list, 8, 'All tools loaded'); # read, write, exec, bash, search, grep, edit, list

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

# Mock tool functions
sub mock_read { return "mock read: $_[0]" }
sub mock_write { return "mock write: $_[0] -> $_[1]" }
sub mock_exec { return "mock exec: $_[0]" }
sub mock_search { return "mock search: $_[0] in $_[1]" }