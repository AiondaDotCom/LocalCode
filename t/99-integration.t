#!/usr/bin/env perl
use strict;
use warnings;
use Test::More tests => 40;
use File::Temp qw(tempdir tempfile);
use lib 'lib';

# Test complete integration of all components
BEGIN { 
    use_ok('LocalCode::Client');
    use_ok('LocalCode::UI'); 
    use_ok('LocalCode::Tools');
    use_ok('LocalCode::Config');
    use_ok('LocalCode::Session');
    use_ok('LocalCode::Permissions');
}

my $temp_dir = tempdir(CLEANUP => 1);

# Initialize all components
my $config = LocalCode::Config->new();
my $client = LocalCode::Client->new(config => $config);
my $tools = LocalCode::Tools->new(config => $config);
my $permissions = LocalCode::Permissions->new(config => $config);
my $session = LocalCode::Session->new(session_dir => $temp_dir, config => $config);
my $ui = LocalCode::UI->new(
    client => $client,
    tools => $tools, 
    permissions => $permissions,
    session => $session,
    config => $config
);

ok($ui, 'Full application stack initialized');

# Set up mock/test mode for all components
$client->{mock_mode} = 1;
$client->{mock_models} = ['codellama', 'llama2'];
$tools->{test_mode} = 1;
$permissions->set_testing_mode('auto_yes');
$ui->{test_mode} = 1;

# Test complete workflow: model management
my $result = $ui->handle_slash_command('/models', $client);
like($result, qr/Available models:/, 'Model listing works end-to-end');

$result = $ui->handle_slash_command('/model llama2', $client);
like($result, qr/Switched to model: llama2/, 'Model switching works end-to-end');
is($client->get_current_model(), 'llama2', 'Model actually changed');

# Test complete workflow: session management  
$session->new_session('integration_test');
$session->add_message('user', 'Test message');

$result = $ui->handle_slash_command('/save integration_session', $session);
like($result, qr/Session saved/, 'Session saving works end-to-end');

$result = $ui->handle_slash_command('/sessions', $session);
like($result, qr/integration_session/, 'Session listing includes saved session');

# Test complete workflow: tool execution with permissions
my $prompt = 'I need to read("/tmp/test.txt") and then write("/tmp/output.txt", "processed content")';
my $injected = $ui->inject_system_prompt($prompt);
like($injected, qr/Tools:/, 'System prompt injection works');

my @tool_calls = $ui->parse_tool_calls($prompt);
is(scalar @tool_calls, 2, 'Tool calls parsed correctly');

# Execute tools through permission system
foreach my $tool_call (@tool_calls) {
    my $permitted = $permissions->request_permission($tool_call->{name}, $tool_call->{args});
    ok($permitted, "Permission granted for $tool_call->{name}");
    
    my $tool_result = $tools->execute_tool($tool_call->{name}, $tool_call->{args});
    ok($tool_result->{success}, "Tool $tool_call->{name} executed successfully");
}

# Test chat flow with tool integration
my $chat_response = $client->chat($injected);
ok($chat_response, 'Chat response received');

# Add to session history
$session->add_message('user', $prompt);
$session->add_message('assistant', $chat_response);

my @history = $session->get_history();
is(scalar @history, 3, 'Chat added to session history');

# Test complete TUI automation
my @automation_commands = (
    '/models',
    '/current', 
    '/model codellama',
    '/tools',
    '/permissions',
    '/save full_test_session',
    '/sessions',
    '/clear',
    '/help',
    '/exit'
);

my $automation_result = $ui->run_automated_session(\@automation_commands);
ok($automation_result, 'Full TUI automation completed');
like($automation_result->{output}, qr/Available models:.*Current model:.*Available tools:/s, 'All TUI commands executed');

# Test error handling integration
$permissions->set_testing_mode('auto_no');
my $blocked_prompt = 'exec("rm -rf /")';
my @blocked_tools = $ui->parse_tool_calls($blocked_prompt);

foreach my $tool_call (@blocked_tools) {
    my $permitted = $permissions->request_permission($tool_call->{name}, $tool_call->{args});
    ok(!$permitted, "Dangerous command properly blocked");
}

# Test configuration integration
my $config_output = $ui->handle_slash_command('/config', undef);
like($config_output, qr/ollama.*host.*localhost/s, 'Configuration display works');

# Test model fallback integration
$client->{mock_models} = ['phi']; # Remove current model
$client->detect_available_models();
my $fallback_result = $client->set_model('llama2'); # Should fallback
ok($fallback_result, 'Model fallback handled gracefully');

# Test session persistence integration
$session->save_session();
my $new_session = LocalCode::Session->new(session_dir => $temp_dir);
ok($new_session->load_session('integration_test'), 'Session persistence works');

my @loaded_history = $new_session->get_history();
is(scalar @loaded_history, 3, 'Session history preserved');

# Test complete CLI interface simulation
my $cli_args = {
    auto_yes => 1,
    test_mode => 1,
    model => 'codellama'
};

my $cli_result = $ui->simulate_cli_execution('create test script', $cli_args);
ok($cli_result->{success}, 'CLI simulation successful');

# Test comprehensive validation
my $validation_result = $ui->run_comprehensive_validation();
ok($validation_result->{all_systems_ok}, 'All systems validation passed');
is($validation_result->{failed_checks}, 0, 'No failed validation checks');

# Test performance metrics
my $perf_start = time();
$ui->run_automated_session(['/models', '/current', '/tools']);
my $perf_time = time() - $perf_start;
ok($perf_time < 5, 'Performance within acceptable limits');

# Test cleanup and resource management
$session->cleanup_temp_files();
$client->disconnect();
$ui->cleanup_resources();

ok(1, 'Resource cleanup completed without errors');