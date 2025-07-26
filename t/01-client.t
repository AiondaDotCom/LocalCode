#!/usr/bin/env perl
use strict;
use warnings;
use Test::More tests => 15;
use JSON;
use lib 'lib';

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

# Test chat with model parameter
my $response = $client->chat('test prompt', 'mistral');
ok($response, 'Chat response received');
like($response, qr/mock response/, 'Mock response format correct');

# Test connection status
ok($client->connect(), 'Connection established');
is($client->get_status(), 'connected', 'Status correct');

# Test timeout handling
$client->{timeout} = 1;
my $timeout_response = $client->chat('slow request');
like($timeout_response, qr/timeout/, 'Timeout handled correctly');