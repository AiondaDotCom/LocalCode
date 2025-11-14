#!/usr/bin/env perl
use strict;
use warnings;
use File::Path qw(make_path);

# Build script for LocalCode - creates standalone executable

print "Building LocalCode standalone executable...\n";

# Read all module files from lib/ (relative to src/)
# Order matters: dependencies first!
my @modules = qw(
    lib/LocalCode/YAML.pm
    lib/LocalCode/JSON.pm
    lib/LocalCode/HTTP.pm
    lib/LocalCode/ReadLine.pm
    lib/LocalCode/Config.pm
    lib/LocalCode/Client.pm
    lib/LocalCode/Tools.pm
    lib/LocalCode/UI.pm
    lib/LocalCode/Session.pm
    lib/LocalCode/Permissions.pm
);

my $template_file = 'bin/localcode.original';
my $output_file = '../localcode';

# Start building the combined script
my $combined = "#!/usr/bin/env perl\n";
$combined .= "use strict;\n";
$combined .= "use warnings;\n\n";

# Embed all modules inline
for my $module_file (@modules) {
    print "  Including $module_file...\n";

    open my $fh, '<', $module_file or die "Cannot read $module_file: $!";
    my $content = do { local $/; <$fh> };
    close $fh;

    # Remove package-specific pragmas and LocalCode:: use statements (already inlined)
    $content =~ s/^use strict;\s*\n//m;
    $content =~ s/^use warnings;\s*\n//m;
    $content =~ s/^use LocalCode::\w+;\s*\n//gm;

    # Add the package content with a separator
    my ($package_name) = $module_file =~ m{lib/(.+)\.pm$};
    $package_name =~ s{/}{::}g if $package_name;

    $combined .= "# BEGIN INLINED MODULE: $package_name\n";
    $combined .= $content;
    $combined .= "\n# END INLINED MODULE: $package_name\n\n";
}

# Now add the main script template
print "  Including main script template...\n";
open my $main_fh, '<', $template_file or die "Cannot read $template_file: $!";
my $main_content = do { local $/; <$main_fh> };
close $main_fh;

# Remove shebang and module use statements from main script
$main_content =~ s/^#!.*?\n//;
$main_content =~ s/^use strict;\s*\n//;
$main_content =~ s/^use warnings;\s*\n//;
$main_content =~ s/^use lib 'lib';\s*\n//;
$main_content =~ s/^use Getopt::Long;\s*\n//;
$main_content =~ s/^use LocalCode::Config;\s*\n//;
$main_content =~ s/^use LocalCode::Client;\s*\n//;
$main_content =~ s/^use LocalCode::UI;\s*\n//;
$main_content =~ s/^use LocalCode::Tools;\s*\n//;
$main_content =~ s/^use LocalCode::Permissions;\s*\n//;
$main_content =~ s/^use LocalCode::Session;\s*\n//;

# Add back Getopt::Long which we need
$main_content = "use Getopt::Long;\n\n" . $main_content;

# Add main script content
$combined .= "# BEGIN MAIN SCRIPT\n";
$combined .= $main_content;
$combined .= "\n# END MAIN SCRIPT\n";

# Write to output file
print "  Writing to $output_file...\n";
open my $out_fh, '>', $output_file or die "Cannot write $output_file: $!";
print $out_fh $combined;
close $out_fh;

# Make executable
chmod 0755, $output_file;

print "✓ Build complete! Standalone executable: $output_file\n";
print "  File size: " . (-s $output_file) . " bytes\n";
print "  You can now run: ./$output_file\n";
