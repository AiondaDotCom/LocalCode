#!/usr/bin/env perl
use strict;
use warnings;
use Test::More tests => 12;

BEGIN { use_ok('LocalCode::HTTP') }

# Test HTTP client creation
my $http = LocalCode::HTTP->new();
ok($http, 'HTTP client created');
isa_ok($http, 'LocalCode::HTTP');

# Test HTTP client with timeout
my $http_timeout = LocalCode::HTTP->new(timeout => 30);
ok($http_timeout, 'HTTP client with timeout created');
is($http_timeout->{timeout}, 30, 'Timeout set correctly');

# Test _parse_response method
my $test_response = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\"status\":\"ok\"}";
my $parsed = $http->_parse_response($test_response);
ok($parsed, 'Response parsed');
isa_ok($parsed, 'LocalCode::HTTP::Response');
is($parsed->code(), 200, 'Status code extracted correctly');
ok($parsed->is_success(), 'Success status detected');
is($parsed->content(), '{"status":"ok"}', 'Body extracted correctly');

# Test response with different status
my $error_response = "HTTP/1.1 404 Not Found\r\nContent-Type: text/html\r\n\r\nNot Found";
my $error_parsed = $http->_parse_response($error_response);
is($error_parsed->code(), 404, 'Error code extracted correctly');
ok(!$error_parsed->is_success(), 'Error status detected correctly');
