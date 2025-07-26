#!/usr/bin/env perl
use strict;
use warnings;
use Test::More tests => 20;
use lib 'lib';

BEGIN { use_ok('LocalCode::UI') }

my $ui = LocalCode::UI->new();
ok($ui, 'UI object created');

# Test system prompt injection
my $prompt = $ui->inject_system_prompt('user prompt');
like($prompt, qr/Tools:/, 'System prompt injected');
like($prompt, qr/read\(file\)/, 'Tools listed in prompt');
like($prompt, qr/Safe: read,search/, 'Safe tools indicated');
like($prompt, qr/user prompt/, 'Original prompt preserved');

# Test tool call parsing
my $response = 'I will read("/tmp/test.txt") and then write("/tmp/output.txt","content")';
my @tools = $ui->parse_tool_calls($response);
is(scalar @tools, 2, 'Two tool calls parsed');
is($tools[0]->{name}, 'read', 'First tool name correct');
is($tools[0]->{args}[0], '/tmp/test.txt', 'First tool arg correct');
is($tools[1]->{name}, 'write', 'Second tool name correct');

# Test slash command handling
ok($ui->handle_slash_commands('/models'), '/models command handled');
ok($ui->handle_slash_commands('/current'), '/current command handled');
ok($ui->handle_slash_commands('/help'), '/help command handled');
ok($ui->handle_slash_commands('/exit'), '/exit command handled');
ok(!$ui->handle_slash_commands('/invalid'), 'Invalid command rejected');

# Test permission dialog
$ui->{test_mode} = 1;
$ui->{auto_approve} = 1;
my $result = $ui->show_permission_dialog('write', '/tmp/test.txt');
ok($result, 'Permission granted in test mode');

$ui->{auto_approve} = 0;
$result = $ui->show_permission_dialog('write', '/tmp/test.txt');
ok(!$result, 'Permission denied in test mode');

# Test display formatting
my $formatted = $ui->display_response('test response');
like($formatted, qr/test response/, 'Response formatted');

# Test progress indicators
ok($ui->show_progress('Testing...'), 'Progress indicator shown');

# Test color support
$ui->{colors} = 1;
my $colored = $ui->colorize('test', 'green');
like($colored, qr/test/, 'Text colorized');