package LocalCode::YAML;
use strict;
use warnings;

# Minimal YAML parser - only supports what we need for config files
# No external dependencies

sub new {
    my ($class) = @_;
    return bless {}, $class;
}

sub read {
    my ($class, $file) = @_;

    return unless -f $file;

    open my $fh, '<', $file or return;
    my $content = do { local $/; <$fh> };
    close $fh;

    return $class->parse($content);
}

sub parse {
    my ($class, $yaml_text) = @_;

    my $data = {};
    my @stack = ($data);
    my @indent_stack = (-1);
    my $current = $data;

    for my $line (split /\n/, $yaml_text) {
        # Skip comments and empty lines
        next if $line =~ /^\s*#/ || $line =~ /^\s*$/;

        # Calculate indentation
        my ($indent) = $line =~ /^(\s*)/;
        my $indent_level = length($indent);

        # Remove leading whitespace
        $line =~ s/^\s+//;

        # Handle key-value pairs
        if ($line =~ /^([^:]+):\s*(.*)$/) {
            my ($key, $value) = ($1, $2);
            $key =~ s/^\s+|\s+$//g;

            # Pop stack if dedented
            while (@indent_stack > 1 && $indent_level <= $indent_stack[-1]) {
                pop @stack;
                pop @indent_stack;
            }
            $current = $stack[-1];

            if ($value eq '' || $value eq '~') {
                # Empty value or null - check if next line is indented (nested object)
                $current->{$key} = {};
                push @stack, $current->{$key};
                push @indent_stack, $indent_level;
            } elsif ($value =~ /^['"](.*)['"]$/) {
                # Quoted string
                $current->{$key} = $1;
            } elsif ($value eq 'true') {
                $current->{$key} = 1;
            } elsif ($value eq 'false') {
                $current->{$key} = 0;
            } elsif ($value =~ /^-?\d+$/) {
                # Integer
                $current->{$key} = int($value);
            } elsif ($value =~ /^-?\d+\.\d+$/) {
                # Float
                $current->{$key} = $value + 0;
            } elsif ($value =~ /^\[(.+)\]$/) {
                # Inline array
                my $array_content = $1;
                $current->{$key} = [map {
                    s/^\s+|\s+$//g;
                    s/^['"]|['"]$//g;
                    $_
                } split /,/, $array_content];
            } else {
                # Plain string
                $current->{$key} = $value;
            }
        }
        # Handle array items
        elsif ($line =~ /^-\s+(.+)$/) {
            my $value = $1;
            $value =~ s/^['"]|['"]$//g;

            # Find the parent key (last key in current hash that has undefined or is becoming array)
            my @keys = keys %$current;
            if (@keys) {
                my $last_key = $keys[-1];
                if (!defined $current->{$last_key} || ref $current->{$last_key} eq 'HASH') {
                    $current->{$last_key} = [];
                }
                if (ref $current->{$last_key} eq 'ARRAY') {
                    push @{$current->{$last_key}}, $value;
                }
            }
        }
    }

    return [$data];
}

1;
