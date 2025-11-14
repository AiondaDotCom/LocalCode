#!/usr/bin/perl
use strict;
use warnings;
use Test::More tests => 11;
use File::Temp qw(tempdir);
use FindBin;
use lib "$FindBin::Bin/../lib";

# Test Home Directory Persistence Features  
# Tests ~/.localcode directory creation and model persistence

use LocalCode::Config;
use LocalCode::Session;

# Create temporary home directory for testing
my $temp_home = tempdir(CLEANUP => 1);
local $ENV{HOME} = $temp_home;

# Test 1: Config creates ~/.localcode structure
my $config = LocalCode::Config->new();
isa_ok($config, 'LocalCode::Config', 'Config object created');

# Test 2: ~/.localcode directory exists
my $localcode_dir = $config->get_localcode_dir();
ok(-d $localcode_dir, '~/.localcode directory created');
like($localcode_dir, qr/\.localcode$/, 'Correct directory name');

# Test 3: Subdirectories created
ok(-d $config->get_sessions_dir(), 'sessions directory created');

# Test 4: Model persistence
$config->save_last_model('test-model');
my $loaded_model = $config->load_last_model();
is($loaded_model, 'test-model', 'Last model saved and loaded correctly');

# Test 5: Model persistence file exists
my $model_file = File::Spec->catfile($localcode_dir, 'last_model.txt');
ok(-f $model_file, 'Model persistence file created');

# Test 6: Session functionality
my $session = LocalCode::Session->new(config => $config);
isa_ok($session, 'LocalCode::Session', 'Session created');

# Test 7: Session history functionality
$session->add_message('user', 'Test message 1');
$session->add_message('assistant', 'Test response 1');
$session->add_message('user', 'Test message 2');

my @history = $session->get_history();
is(scalar @history, 3, 'Session history contains all messages');
is($history[0]->{content}, 'Test message 1', 'First message content correct');
is($history[2]->{role}, 'user', 'Last message role correct');

# Test cleanup
$session->clear_session();
@history = $session->get_history();
is(scalar @history, 0, 'Session history cleared successfully');

# Tests completed

__END__

=head1 NAME

11-home-persistence.t - Test home directory persistence features

=head1 DESCRIPTION

Tests the persistence features:

- ~/.localcode directory structure creation
- Last used model persistence  
- Session history functionality
- Automatic directory management

=head1 COVERAGE

✅ Config home directory management
✅ Model state persistence
✅ Session history functionality  
✅ File system integration
✅ Cleanup operations

All features work without requiring existing ~/.localcode directory.