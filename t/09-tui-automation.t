#!/usr/bin/env perl
use strict;
use warnings;
use Test::More tests => 26;
use File::Temp qw(tempfile tempdir);
use lib 'lib';

BEGIN { use_ok('LocalCode::UI') }

my $ui = LocalCode::UI->new();
ok($ui, 'UI object created for automation testing');

# Test input file processing
my ($fh, $input_file) = tempfile();
print $fh "/models\n/current\n/tools\n/help\n/exit\n";
close $fh;

my @commands = $ui->read_command_file($input_file);
is(scalar @commands, 5, 'All commands read from file');
is($commands[0], '/models', 'First command correct');
is($commands[4], '/exit', 'Last command correct');

# Test stdin command processing
my $stdin_commands = "/models\n/current\n/exit";
my @stdin_parsed = $ui->parse_stdin_commands($stdin_commands);
is(scalar @stdin_parsed, 3, 'Stdin commands parsed');

# Test automated TUI session
$ui->{test_mode} = 1;
$ui->{mock_mode} = 1;

my $session_result = $ui->run_automated_session(\@commands);
ok($session_result, 'Automated session completed');
like($session_result->{output}, qr/Available models:/, 'Models command output present');
like($session_result->{output}, qr/Current model:/, 'Current command output present');
like($session_result->{output}, qr/Available tools:/, 'Tools command output present');

# Test command validation in batch mode
my @invalid_commands = ('/invalid', '/models', '/badcommand');
my $validation = $ui->validate_command_batch(\@invalid_commands);
ok(!$validation->{valid}, 'Batch with invalid commands fails validation');
is(scalar @{$validation->{errors}}, 2, 'Two invalid commands detected');

my @valid_commands = ('/models', '/current', '/help');
$validation = $ui->validate_command_batch(\@valid_commands);
ok($validation->{valid}, 'Valid command batch passes');

# Test timeout handling in automation
$ui->{command_timeout} = 1;
my $timeout_result = $ui->run_command_with_timeout('/slowcommand');
ok(!$timeout_result->{success}, 'Timeout handled correctly');
like($timeout_result->{error}, qr/timeout/i, 'Timeout error message');

# Test output capture and validation
my $output = $ui->capture_command_output('/models');
ok($output, 'Command output captured');

my $patterns = {
    '/models' => qr/Available models:/,
    '/current' => qr/Current model:/,
    '/tools' => qr/Available tools:/,
    '/help' => qr/Available commands:/
};

foreach my $cmd (keys %$patterns) {
    my $output = $ui->capture_command_output($cmd);
    like($output, $patterns->{$cmd}, "$cmd output matches expected pattern");
}

# Test error handling in automation
my $error_output = $ui->capture_command_output('/nonexistent');
like($error_output, qr/Unknown command/i, 'Error message for invalid command');

# Test batch execution with mixed results
my @mixed_commands = ('/models', '/invalid', '/current');
my $mixed_result = $ui->run_batch_with_error_handling(\@mixed_commands);
ok($mixed_result->{completed}, 'Batch completed despite errors');
is($mixed_result->{success_count}, 2, 'Two commands succeeded');
is($mixed_result->{error_count}, 1, 'One command failed');

# Test comprehensive automation suite (simplified)
my $full_test_result = $ui->run_comprehensive_test_suite();
ok($full_test_result->{passed}, 'Comprehensive test suite passed');
is($full_test_result->{total_tests}, 13, 'All basic TUI commands tested');

unlink $input_file;