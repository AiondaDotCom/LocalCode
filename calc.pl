#!/usr/bin/perl
use strict;
use warnings;
print "Enter first number: ";
my $num1 = <STDIN>;
chomp($num1);
print "Enter second number: ";
my $num2 = <STDIN>;
chomp($num2);
print "Choose operation (+, -, *, /): ";
my $operation = <STDIN>;
chomp($operation);
my $result;
eval {
    if ($operation eq '+') { $result = $num1 + $num2; }
    elsif ($operation eq '-') { $result = $num1 - $num2; }
    elsif ($operation eq '*') { $result = $num1 * $num2; }
    elsif ($operation eq '/') {
        if ($num2 != 0) { $result = $num1 / $num2; }
        else { die "Division by zero"; }
    } else { die "Invalid operation\
"; }
};
if ($@) {
    print "$@";
} else {
    print "Result: $result\
";
}
