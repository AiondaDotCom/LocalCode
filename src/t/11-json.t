#!/usr/bin/env perl
use strict;
use warnings;
use Test::More tests => 20;

BEGIN { use_ok('LocalCode::JSON') }

# Test JSON encoder/decoder creation
my $json = LocalCode::JSON->new();
ok($json, 'JSON object created');
isa_ok($json, 'LocalCode::JSON');

# Test encoding scalars
is($json->encode("hello"), '"hello"', 'String encoding works');
is($json->encode(42), '42', 'Number encoding works');
is($json->encode(0), '0', 'Zero encoding works');

# Test encoding special characters
my $special = "hello\nworld\t\"test\"";
my $encoded_special = $json->encode($special);
like($encoded_special, qr/\\n/, 'Newline escaped');
like($encoded_special, qr/\\t/, 'Tab escaped');
like($encoded_special, qr/\\"/, 'Quote escaped');

# Test encoding arrays
my $array = [1, 2, "three"];
my $encoded_array = $json->encode($array);
is($encoded_array, '[1,2,"three"]', 'Array encoding works');

# Test encoding objects
my $obj = {name => "test", value => 42};
my $encoded_obj = $json->encode($obj);
like($encoded_obj, qr/"name":"test"/, 'Object encoding works');
like($encoded_obj, qr/"value":42/, 'Object values encoded');

# Test pretty printing
my $json_pretty = LocalCode::JSON->new()->pretty();
my $pretty_obj = $json_pretty->encode({a => 1, b => 2});
like($pretty_obj, qr/\n/, 'Pretty print adds newlines');

# Test decoding
my $decoded_str = $json->decode('"hello"');
is($decoded_str, 'hello', 'String decoding works');

my $decoded_num = $json->decode('42');
is($decoded_num, 42, 'Number decoding works');

my $decoded_array = $json->decode('[1,2,3]');
is_deeply($decoded_array, [1,2,3], 'Array decoding works');

my $decoded_obj = $json->decode('{"name":"test","value":42}');
is_deeply($decoded_obj, {name => "test", value => 42}, 'Object decoding works');

# Test null, true, false
is($json->decode('null'), undef, 'Null decoding works');
is($json->decode('true'), 1, 'True decoding works');
is($json->decode('false'), 0, 'False decoding works');
