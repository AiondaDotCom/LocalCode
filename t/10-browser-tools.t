#!/usr/bin/perl
use strict;
use warnings;
use Test::More;
use FindBin;
use lib "$FindBin::Bin/../lib";
use LocalCode::Tools;

# Test Browser Tools
# Tests for websearch, webopen, webfind functionality

plan tests => 16;

# Create a Tools instance
my $tools = LocalCode::Tools->new(
    config => {},
    permissions => {},
    timeout => 60
);

# Set test mode
$tools->{test_mode} = 1;
$tools->{mock_execution} = 1;

# Test 1: Tools object creation
isa_ok($tools, 'LocalCode::Tools', 'Tools object created');

# Test 2-4: Verify browser tools are registered
ok($tools->validate_tool('websearch'), 'websearch tool registered');
ok($tools->validate_tool('webopen'), 'webopen tool registered'); 
ok($tools->validate_tool('webfind'), 'webfind tool registered');

# Test 5-7: Check permissions (all should be SAFE = 0)
is($tools->check_permission('websearch'), 0, 'websearch is SAFE');
is($tools->check_permission('webopen'), 0, 'webopen is SAFE');
is($tools->check_permission('webfind'), 0, 'webfind is SAFE');

# Test 8: Browser state initialization
ok(exists $tools->{browser_pages}, 'browser_pages initialized');
ok(exists $tools->{browser_stack}, 'browser_stack initialized');
is($tools->{current_page_id}, 0, 'current_page_id starts at 0');

# Test 9: Mock websearch execution
$tools->{mock_execution} = 1;
my $result = $tools->execute_tool('websearch', ['perl programming']);
ok($result->{success}, 'websearch mock execution succeeds');
like($result->{output}, qr/mock websearch/, 'websearch mock output correct');

# Test 10: Mock webopen execution  
$result = $tools->execute_tool('webopen', ['https://perl.org']);
ok($result->{success}, 'webopen mock execution succeeds');
like($result->{output}, qr/mock webopen/, 'webopen mock output correct');

# Test 11: Mock webfind execution
$result = $tools->execute_tool('webfind', ['documentation']);
ok($result->{success}, 'webfind mock execution succeeds');

# Test browser tool argument validation
$result = $tools->execute_tool('websearch', []);
ok(!$result->{success}, 'websearch fails with no arguments');

# Tests completed

__END__

=head1 NAME

10-browser-tools.t - Test browser tools functionality

=head1 DESCRIPTION

Tests the websearch, webopen, and webfind tools:

- Tool registration and permissions
- Browser state management  
- Mock execution modes
- Argument validation

=head1 TESTING MODES

- Mock mode: Simulates tool execution without network calls
- Test mode: Enables controlled testing environment

=head1 COVERAGE

✅ Tool registration (websearch, webopen, webfind)
✅ Permission levels (all SAFE)
✅ State initialization 
✅ Mock execution
✅ Argument validation

Network calls are tested via mock mode to avoid dependencies.