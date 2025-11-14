#!/usr/bin/env perl
use strict;
use warnings;
use Test::More tests => 15;
use File::Temp qw(tempfile);

BEGIN { use_ok('LocalCode::YAML') }

# Test YAML parser creation
my $yaml = LocalCode::YAML->new();
ok($yaml, 'YAML object created');
isa_ok($yaml, 'LocalCode::YAML');

# Test parsing simple YAML
my $simple_yaml = "name: test\nvalue: 42\n";
my $parsed = $yaml->parse($simple_yaml);
ok($parsed, 'Simple YAML parsed');
is($parsed->[0]->{name}, 'test', 'String value parsed');
is($parsed->[0]->{value}, 42, 'Number value parsed');

# Test parsing nested YAML
my $nested_yaml = "server:\n  host: localhost\n  port: 8080\n";
my $parsed_nested = $yaml->parse($nested_yaml);
ok($parsed_nested, 'Nested YAML parsed');
is($parsed_nested->[0]->{server}->{host}, 'localhost', 'Nested string parsed');
is($parsed_nested->[0]->{server}->{port}, 8080, 'Nested number parsed');

# Test parsing booleans
my $bool_yaml = "enabled: true\ndisabled: false\n";
my $parsed_bool = $yaml->parse($bool_yaml);
is($parsed_bool->[0]->{enabled}, 1, 'True parsed');
is($parsed_bool->[0]->{disabled}, 0, 'False parsed');

# Test reading from file
my ($fh, $test_file) = tempfile();
print $fh "test: value\nnumber: 123\n";
close $fh;

my $from_file = $yaml->read($test_file);
ok($from_file, 'YAML read from file');
is($from_file->[0]->{test}, 'value', 'File content parsed correctly');
is($from_file->[0]->{number}, 123, 'File number parsed correctly');

# Test comments and empty lines
my $yaml_with_comments = "# Comment\nkey: value\n\n# Another comment\nkey2: value2\n";
my $parsed_comments = $yaml->parse($yaml_with_comments);
is($parsed_comments->[0]->{key}, 'value', 'Comments ignored correctly');

unlink $test_file;
