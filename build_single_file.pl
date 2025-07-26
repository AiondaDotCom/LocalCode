#!/usr/bin/perl
use strict;
use warnings;

# Create single-file distribution that properly handles namespaces

my $output_file = "dist/localcode";
open my $out, '>', $output_file or die "Cannot open $output_file: $!";

print $out "#!/usr/bin/perl\n";
print $out "# LocalCode - Single-file release build\n";
print $out "# Generated: " . localtime() . "\n";
print $out "use strict;\nuse warnings;\nuse Getopt::Long;\n\n";

# Define the module order and their proper namespaces
my @modules = (
    { file => 'lib/LocalCode/Config.pm', package => 'LocalCode::Config' },
    { file => 'lib/LocalCode/Permissions.pm', package => 'LocalCode::Permissions' },
    { file => 'lib/LocalCode/Session.pm', package => 'LocalCode::Session' },
    { file => 'lib/LocalCode/Client.pm', package => 'LocalCode::Client' },
    { file => 'lib/LocalCode/Tools.pm', package => 'LocalCode::Tools' },
    { file => 'lib/LocalCode/UI.pm', package => 'LocalCode::UI' },
);

# Process each module
for my $module (@modules) {
    print $out "# === $module->{package} ===\n";
    print $out "{\n";
    print $out "package $module->{package};\n";
    
    open my $in, '<', $module->{file} or die "Cannot open $module->{file}: $!";
    my $in_package = 0;
    while (my $line = <$in>) {
        # Skip package declaration and use strict/warnings at start
        next if $line =~ /^package\s+/ && !$in_package;
        next if $line =~ /^use strict/ && !$in_package;
        next if $line =~ /^use warnings/ && !$in_package;
        next if $line =~ /^1;\s*$/ && eof($in);
        
        $in_package = 1;
        print $out $line;
    }
    close $in;
    
    print $out "}\n\n";
}

# Add main executable
print $out "# === Main executable ===\n";
open my $main, '<', 'bin/localcode' or die "Cannot open bin/localcode: $!";
my $skip_headers = 1;
while (my $line = <$main>) {
    # Skip shebang and use statements
    if ($skip_headers) {
        next if $line =~ /^#!/;
        next if $line =~ /^use strict/;
        next if $line =~ /^use warnings/;
        next if $line =~ /^use lib/;
        next if $line =~ /^use LocalCode::/;
        next if $line =~ /^use Getopt::Long/;
        $skip_headers = 0 if $line =~ /\S/; # First non-whitespace, non-use line
    }
    print $out $line;
}
close $main;
close $out;

chmod 0755, $output_file;
print "✅ Built $output_file\n";