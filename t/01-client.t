#!/usr/bin/env perl
use strict;
use warnings;
use Test::More tests => 19;
use JSON;
use HTTP::Response;
use lib 'lib';

# Mock UserAgent for testing error responses
package MockUserAgent;
sub new {
    my ($class, $response) = @_;
    bless { response => $response }, $class;
}
sub post { return shift->{response}; }
sub get { return shift->{response}; }
package main;

BEGIN { use_ok('LocalCode::Client') }

my $client = LocalCode::Client->new();
ok($client, 'Client object created');

# Test connection without real Ollama (mock mode)
$client->{mock_mode} = 1;
$client->{mock_models} = ['llama3', 'llama2', 'mistral'];

# Test list_models
my @models = $client->list_models();
is(scalar @models, 3, 'Mock models returned');
is($models[0], 'llama2', 'First model correct (alphabetically sorted)');

# Test model validation
ok($client->validate_model('llama3'), 'Valid model accepted');
ok(!$client->validate_model('nonexistent'), 'Invalid model rejected');

# Test set_model
ok($client->set_model('llama2'), 'Model switch successful');
is($client->get_current_model(), 'llama2', 'Current model updated');

# Test invalid model handling  
ok(!$client->set_model('nonexistent'), 'Invalid model rejected');
is($client->get_current_model(), 'llama2', 'Current model unchanged');

# Test chat with model parameter and messages array
my $messages = [
    { role => 'system', content => 'You are a helpful assistant' },
    { role => 'user', content => 'test prompt' }
];
my $response = $client->chat('', 'mistral', $messages);
ok($response, 'Chat response received');
like($response, qr/mock response/, 'Mock response format correct');

# Test chat with simple prompt (backward compatibility)
my $simple_response = $client->chat('test prompt', 'mistral');
ok($simple_response, 'Simple chat response received');
like($simple_response, qr/mock response/, 'Simple mock response format correct');

# Test connection status
ok($client->connect(), 'Connection established');
is($client->get_status(), 'connected', 'Status correct');

# Test timeout handling
$client->{timeout} = 1;
my $timeout_response = $client->chat('slow request');
like($timeout_response, qr/timeout/, 'Timeout handled correctly');

# Test context length exceeded error simulation
$client->{mock_mode} = 0; # Temporarily disable mock mode to test error parsing
# Mock a response that would come from Ollama with context length error
my $mock_response = HTTP::Response->new(400, 'Bad Request');
$mock_response->content('{"error":"context length exceeded"}');
$client->{ua} = MockUserAgent->new($mock_response);

my $context_error_response = $client->chat('test prompt');
is(ref $context_error_response, 'HASH', 'Context length error returns hash reference');
is($context_error_response->{error}, 'context_length_exceeded', 'Context length error detected correctly');

# Reset mock mode
$client->{mock_mode} = 1;