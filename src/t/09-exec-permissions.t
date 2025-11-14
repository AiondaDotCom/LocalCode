#!/usr/bin/env perl
use strict;
use warnings;
use Test::More tests => 13;
use File::Temp qw(tempfile);
use FindBin;
use lib "$FindBin::Bin/../lib";

use_ok('LocalCode::Tools');

# Create a Tools instance
my $tools = LocalCode::Tools->new();
isa_ok($tools, 'LocalCode::Tools');

# Test 1: Create a script file without execute permissions
my ($fh, $script_file) = tempfile(SUFFIX => '.pl', UNLINK => 1);
print $fh "#!/usr/bin/perl\nprint \"Hello\\n\";\n";
close $fh;

# Ensure file has no execute permission
chmod 0644, $script_file;
ok(!-x $script_file, 'Test script does not have execute permission');

# Test 2: Try to execute the script directly - should fail with permission error
my $result = $tools->execute_tool('bash', ["$script_file"]);
ok(!$result->{success}, 'Execution should fail without execute permission');
like($result->{error}, qr/EXECUTION DENIED/, 'Error message should mention execution denied');
like($result->{error}, qr/does not have execute permission/, 'Error message should explain missing permission');
like($result->{error}, qr/Current permissions: rw-r--r--/, 'Error should show current permissions');
like($result->{error}, qr/chmod \+x/, 'Error should suggest chmod fix');

# Test 3: Try with full path directly
$result = $tools->execute_tool('exec', [$script_file]);
ok(!$result->{success}, 'Execution with full path via exec should also fail');
like($result->{error}, qr/EXECUTION DENIED/, 'Should get permission error with full path');

# Test 4: Verify perl script suggestion
like($result->{error}, qr/perl/, 'Should suggest perl interpreter for .pl files');

# Test 5: Test with executable file - should work
chmod 0755, $script_file;
ok(-x $script_file, 'Test script now has execute permission');
$result = $tools->execute_tool('bash', ["perl $script_file"]);
ok($result->{success}, 'Execution should succeed with interpreter');

done_testing();
