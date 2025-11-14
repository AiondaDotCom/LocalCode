#!/usr/bin/env perl
use strict;
use warnings;
use Test::More tests => 30;
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

# Test get_messages_for_chat method
my $system_prompt = "You are a helpful assistant";
my $messages = $session->get_messages_for_chat($system_prompt);
ok($messages, 'Messages for chat created');
is(ref $messages, 'ARRAY', 'Messages is array reference');
is($messages->[0]->{role}, 'system', 'First message is system');
is($messages->[0]->{content}, $system_prompt, 'System prompt correct');
is($messages->[1]->{role}, 'user', 'Second message is user');
is($messages->[2]->{role}, 'assistant', 'Third message is assistant');

# Test without system prompt
my $messages_no_system = $session->get_messages_for_chat();
is($messages_no_system->[0]->{role}, 'user', 'First message is user when no system prompt');

# Test session clearing
$session->clear_session();
@history = $session->get_history();
is(scalar @history, 0, 'Session cleared');

# Test session deletion
ok($session->delete_session('test_session'), 'Session deleted');
ok(!-f $session_file, 'Session file removed');

# Test context length truncation
$session->new_session('truncate_session');
for my $i (1..20) {
    $session->add_message('user', "User message $i");
    $session->add_message('assistant', "Assistant response $i");
}

my $removed = $session->truncate_history_for_context(3); # Remove oldest 3 pairs
is($removed, 6, 'Correct number of messages removed during truncation');

my @truncated_history = $session->get_history();
my @non_system_truncated = grep { $_->{role} ne 'system' } @truncated_history;
is(scalar @non_system_truncated, 34, 'Correct number of messages kept after truncation (40-6=34)');

# Test that system messages are preserved during truncation
$session->add_message('system', 'Tool feedback message');
$session->add_message('user', 'Another user message');
$session->add_message('assistant', 'Another assistant response');

$session->truncate_history_for_context(2); # Remove oldest 2 pairs
my @final_history = $session->get_history();
my @system_messages = grep { $_->{role} eq 'system' } @final_history;
ok(scalar @system_messages > 0, 'System messages preserved during truncation');

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