#!/usr/bin/env perl
use strict;
use warnings;
use Test::More tests => 22;
use lib 'lib';

BEGIN { use_ok('LocalCode::Client') }

my $client = LocalCode::Client->new();
ok($client, 'Client created');

# Setup mock environment
$client->{mock_mode} = 1;
$client->{mock_models} = ['llama3', 'llama2', 'mistral', 'phi'];

# Test initial model detection
$client->detect_available_models();
my @models = $client->list_models();
is(scalar @models, 4, 'All mock models detected');

# Test default model fallback
ok($client->set_default_model('llama3'), 'Default model set');
is($client->get_default_model(), 'llama3', 'Default model stored');

# Test current model initialization
ok($client->initialize_current_model(), 'Current model initialized');
is($client->get_current_model(), 'llama3', 'Current model set to default');

# Test model switching
ok($client->set_model('llama2'), 'Model switch to llama2');
is($client->get_current_model(), 'llama2', 'Current model updated');

ok($client->set_model('mistral'), 'Model switch to mistral');
is($client->get_current_model(), 'mistral', 'Current model updated again');

# Test invalid model handling
ok(!$client->set_model('nonexistent'), 'Invalid model rejected');
is($client->get_current_model(), 'mistral', 'Current model unchanged after invalid');

# Test model validation
ok($client->validate_model('phi'), 'Valid model validated');
ok(!$client->validate_model('gpt4'), 'Invalid model rejected by validation');

# Test model availability check
ok($client->is_model_available('llama2'), 'Available model check true');
ok(!$client->is_model_available('chatgpt'), 'Unavailable model check false');

# Test model fallback scenario
$client->{mock_models} = ['llama2']; # Remove current model from available
$client->detect_available_models();
ok(!$client->set_model('mistral'), 'Invalid model rejected');
is($client->get_current_model(), 'mistral', 'Current model unchanged after invalid');

# Test model with chat context
$client->set_model('llama2');
my $response = $client->chat('test prompt');
ok($response, 'Chat with specific model works');
like($response, qr/llama2/, 'Response indicates correct model used');

# Test model persistence across sessions
my $saved_model = $client->get_current_model();
my $new_client = LocalCode::Client->new();
$new_client->{mock_mode} = 1;
$new_client->{mock_models} = ['codellama', 'llama2', 'mistral'];
$new_client->restore_model($saved_model);
is($new_client->get_current_model(), $saved_model, 'Model restored from session');