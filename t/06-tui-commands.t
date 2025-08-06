#!/usr/bin/env perl
use strict;
use warnings;
use Test::More tests => 40;
use File::Temp qw(tempdir);
use lib 'lib';

BEGIN { 
    use_ok('LocalCode::UI');
    use_ok('LocalCode::Client');
    use_ok('LocalCode::Session');
}

my $temp_dir = tempdir(CLEANUP => 1);

# Create components with proper initialization
use LocalCode::Config;
use LocalCode::Permissions;
use LocalCode::Tools;

my $config = LocalCode::Config->new();
my $permissions = LocalCode::Permissions->new(config => $config);
my $tools = LocalCode::Tools->new(config => $config, permissions => $permissions);
my $client = LocalCode::Client->new();
my $session = LocalCode::Session->new(session_dir => $temp_dir);
my $ui = LocalCode::UI->new(
    config => $config,
    client => $client,
    tools => $tools,
    permissions => $permissions,
    session => $session,
);

# Set up mock mode
$ui->{test_mode} = 1;
$client->{mock_mode} = 1;
$client->{mock_models} = ['llama3', 'llama2', 'mistral'];
$client->set_model('llama3');

# Test /models command
my $output = $ui->handle_slash_command('/models', $client);
ok($output, '/models command executed');
like($output, qr/Available models:/, '/models output format');
like($output, qr/llama3/, '/models includes llama3');
like($output, qr/llama2/, '/models includes llama2');
like($output, qr/\(current\)/, '/models shows current model');

# Test /current command
$output = $ui->handle_slash_command('/current', $client);
ok($output, '/current command executed');
like($output, qr/Current model: llama3/, '/current shows model');

# Test /model switch command  
$output = $ui->handle_slash_command('/model llama2', $client);
ok($output, '/model switch executed');
like($output, qr/Switched to model: llama2/, '/model switch confirmation');
is($client->get_current_model(), 'llama2', 'Model actually switched');

# Test /model with invalid model
$output = $ui->handle_slash_command('/model invalid', $client);
ok($output, '/model invalid executed');
like($output, qr/Model.*not found/, '/model invalid error message');

# Test /tools command
$output = $ui->handle_slash_command('/tools', undef);
ok($output, '/tools command executed');
like($output, qr/Available tools:/, '/tools output format');
like($output, qr/read.*\[SAFE\]/, '/tools shows safe read');
like($output, qr/write.*\[DANGEROUS\]/, '/tools shows dangerous write');

# Test /permissions command
$output = $ui->handle_slash_command('/permissions', undef);
ok($output, '/permissions command executed');
like($output, qr/Permission settings:/, '/permissions output format');
like($output, qr/Safe.*read/, '/permissions lists safe tools');

# Test /config command
$output = $ui->handle_slash_command('/config', undef);
ok($output, '/config command executed');
like($output, qr/Configuration:/, '/config output format');
like($output, qr/host.*localhost/, '/config shows host');

# Test /help command
$output = $ui->handle_slash_command('/help', undef);
ok($output, '/help command executed');
like($output, qr/Available commands:/, '/help output format');
like($output, qr/\/models/, '/help lists models command');
like($output, qr/\/exit/, '/help lists exit command');

# Test session commands
$session->new_session('test_session');

# Test /save command
$output = $ui->handle_slash_command('/save test_save', $session);
ok($output, '/save command executed');
like($output, qr/Session saved: test_save/, '/save confirmation');

# Test /sessions command
$output = $ui->handle_slash_command('/sessions', $session);
ok($output, '/sessions command executed');
like($output, qr/Saved sessions:/, '/sessions output format');

# Test /load command
$output = $ui->handle_slash_command('/load test_save', $session);
ok($output, '/load command executed');
like($output, qr/Session loaded: test_save/, '/load confirmation');

# Test /clear command
$output = $ui->handle_slash_command('/clear', $session);
ok($output, '/clear command executed');
like($output, qr/Session cleared/, '/clear confirmation');

# Test invalid command
$output = $ui->handle_slash_command('/invalid', undef);
ok(!$output, 'Invalid command returns false');

# Test /exit command
$output = $ui->handle_slash_command('/exit', undef);
ok($output, '/exit command executed');
like($output, qr/Goodbye/, '/exit shows goodbye message');