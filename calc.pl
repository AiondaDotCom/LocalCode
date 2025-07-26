#!/usr/bin/perl
use strict;
use warnings;
print 'Enter first number: ';
my $num1 = <STDIN>;
chomp $num1;
print 'Enter second number: ';
my $num2 = <STDIN>;
chomp $num2;
print 'Sum is: ', $num1 + $num2, '\
';
