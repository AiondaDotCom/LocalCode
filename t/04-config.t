#!/usr/bin/env perl
use strict;
use warnings;
use Test::More tests => 18;
use File::Temp qw(tempfile);
use lib 'lib';

BEGIN { use_ok('LocalCode::Config') }

my $config = LocalCode::Config->new();
ok($config, 'Config object created');

# Test default config loading
my $defaults = $config->load_defaults();
ok($defaults, 'Default config loaded');
is($defaults->{ollama}->{host}, 'localhost', 'Default host correct');
is($defaults->{ollama}->{port}, 11434, 'Default port correct');
is($defaults->{ollama}->{default_model}, 'codellama', 'Default model correct');

# Test config file reading
my ($fh, $test_config) = tempfile();
print $fh "ollama:\n  host: testhost\n  port: 8080\nui:\n  colors: false\n";
close $fh;

my $loaded = $config->load_file($test_config);
ok($loaded, 'Config file loaded');
is($loaded->{ollama}->{host}, 'testhost', 'Custom host loaded');
is($loaded->{ollama}->{port}, 8080, 'Custom port loaded');
is($loaded->{ui}->{colors}, 0, 'Custom UI setting loaded');

# Test config validation
ok($config->validate($defaults), 'Default config validates');

my $invalid = { ollama => { port => 'invalid' } };
ok(!$config->validate($invalid), 'Invalid config rejected');

# Test config merging
my $custom = { ollama => { host => 'newhost' } };
my $merged = $config->merge($defaults, $custom);
is($merged->{ollama}->{host}, 'newhost', 'Custom value overrides default');
is($merged->{ollama}->{port}, 11434, 'Default value preserved');

# Test get/set methods
$config->set('ollama.current_model', 'llama2');
is($config->get('ollama.current_model'), 'llama2', 'Config value set/get');

# Test testing mode settings
$config->set_testing_mode('auto_yes');
is($config->get('testing.auto_approve'), 1, 'Auto-yes mode set');

$config->set_testing_mode('auto_no');
is($config->get('testing.auto_approve'), 0, 'Auto-no mode set');

$config->set_testing_mode('simulate');
is($config->get('testing.simulate_only'), 1, 'Simulate mode set');

unlink $test_config;