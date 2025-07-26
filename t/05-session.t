#!/usr/bin/env perl
use strict;
use warnings;
use Test::More tests => 20;
use File::Temp qw(tempdir);
use lib 'lib';

BEGIN { use_ok('LocalCode::Session') }

my $temp_dir = tempdir(CLEANUP => 1);
my $session = LocalCode::Session->new(session_dir => $temp_dir);
ok($session, 'Session object created');

# Test new session creation
my $session_id = $session->new_session('test_session');
ok($session_id, 'New session created');
is($session_id, 'test_session', 'Session ID correct');

# Test adding messages to session
$session->add_message('user', 'Hello');
$session->add_message('assistant', 'Hi there!');
$session->add_message('user', 'How are you?');

my @history = $session->get_history();
is(scalar @history, 3, 'All messages in history');
is($history[0]->{role}, 'user', 'First message role correct');
is($history[0]->{content}, 'Hello', 'First message content correct');
is($history[2]->{role}, 'user', 'Last message role correct');

# Test session saving
ok($session->save_session(), 'Session saved');
my $session_file = "$temp_dir/test_session.json";
ok(-f $session_file, 'Session file created');

# Test session loading
my $new_session = LocalCode::Session->new(session_dir => $temp_dir);
ok($new_session->load_session('test_session'), 'Session loaded');
my @loaded_history = $new_session->get_history();
is(scalar @loaded_history, 3, 'Loaded history correct length');
is($loaded_history[1]->{content}, 'Hi there!', 'Loaded content correct');

# Test session listing
my @sessions = $session->list_sessions();
ok(scalar @sessions >= 1, 'Session in list');
like($sessions[0], qr/test_session/, 'Session name in list');

# Test session clearing
$session->clear_session();
@history = $session->get_history();
is(scalar @history, 0, 'Session cleared');

# Test session deletion
ok($session->delete_session('test_session'), 'Session deleted');
ok(!-f $session_file, 'Session file removed');

# Test history size limit
$session->new_session('limited_session');
$session->{max_history} = 2;
$session->add_message('user', 'Message 1');
$session->add_message('assistant', 'Response 1');
$session->add_message('user', 'Message 2');
$session->add_message('assistant', 'Response 2');
$session->add_message('user', 'Message 3');

@history = $session->get_history();
is(scalar @history, 2, 'History limited to max size');
is($history[0]->{content}, 'Response 2', 'Oldest messages removed');