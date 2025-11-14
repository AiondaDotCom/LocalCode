#!/usr/bin/env perl
use strict;
use warnings;
use Test::More tests => 26;
use lib 'lib';

BEGIN { use_ok('LocalCode::Permissions') }

my $perms = LocalCode::Permissions->new();
ok($perms, 'Permissions object created');

# Test permission level constants
is($perms->SAFE, 0, 'SAFE constant correct');
is($perms->DANGEROUS, 1, 'DANGEROUS constant correct');
is($perms->BLOCKED, 2, 'BLOCKED constant correct');

# Test default permissions
is($perms->get_permission('file_read'), 0, 'file_read is SAFE by default');
is($perms->get_permission('grep_search'), 0, 'grep_search is SAFE by default');
is($perms->get_permission('file_write'), 1, 'file_write is DANGEROUS by default');
is($perms->get_permission('shell_exec'), 1, 'shell_exec is DANGEROUS by default');

# Test permission setting
$perms->set_permission('file_write', 2); # BLOCKED
is($perms->get_permission('file_write'), 2, 'Permission updated to BLOCKED');

# Test permission checking
ok($perms->is_safe('file_read'), 'file_read is safe');
ok($perms->is_dangerous('shell_exec'), 'shell_exec is dangerous');
ok($perms->is_blocked('file_write'), 'file_write is blocked');

# Test permission request
$perms->set_testing_mode('auto_yes');
ok($perms->request_permission('shell_exec', ['ls -la']), 'Permission granted in auto_yes mode');

$perms->set_testing_mode('auto_no');
ok(!$perms->request_permission('shell_exec', ['rm -rf /']), 'Permission denied in auto_no mode');

# Test remember choice functionality
$perms->set_permission('file_write', 1); # Reset to DANGEROUS for this test
$perms->set_testing_mode('interactive');
$perms->{remember_choice} = 1;
$perms->{mock_user_input} = 'a'; # always allow
ok($perms->request_permission('file_write', ['/tmp/test.txt']), 'Permission granted with always');
ok($perms->request_permission('file_write', ['/tmp/test2.txt']), 'Subsequent request auto-allowed');

# Test permission reset
$perms->reset_remembered_permissions();
$perms->{mock_user_input} = 'n'; # deny
ok(!$perms->request_permission('file_write', ['/tmp/test3.txt']), 'Permission denied after reset');

# Test batch permission operations
my @safe_tools = $perms->get_safe_tools();
ok(scalar @safe_tools >= 2, 'Safe tools list populated');
like(join(',', @safe_tools), qr/file_read/, 'file_read in safe tools');

my @dangerous_tools = $perms->get_dangerous_tools();
ok(scalar @dangerous_tools >= 1, 'Dangerous tools list populated');
like(join(',', @dangerous_tools), qr/shell_exec/, 'shell_exec in dangerous tools');

# Test permission validation
ok($perms->validate_tool_request('file_read', ['/etc/passwd']), 'Safe tool request validated');
ok(!$perms->validate_tool_request('shell_exec', ['rm -rf /']), 'Dangerous command blocked');

# Test custom permission rules
$perms->add_custom_rule('file_write', sub {
    my ($tool, $args) = @_;
    return $args->[0] =~ /^\/tmp\// ? 1 : 0; # Only allow /tmp writes
});

ok($perms->validate_tool_request('file_write', ['/tmp/safe.txt']), 'Custom rule allows /tmp write');
ok(!$perms->validate_tool_request('file_write', ['/etc/passwd']), 'Custom rule blocks system write');