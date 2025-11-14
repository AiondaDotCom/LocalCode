package LocalCode::JSON;
use strict;
use warnings;

# Minimal JSON encoder/decoder - no external dependencies
# Supports: objects, arrays, strings, numbers, booleans, null

# Boolean objects for true/false
our $true = bless \(my $dummy = 1), 'LocalCode::JSON::Boolean';
our $false = bless \(my $dummy2 = 0), 'LocalCode::JSON::Boolean';

sub new {
    my ($class) = @_;
    return bless { pretty => 0 }, $class;
}

sub pretty {
    my ($self) = @_;
    $self->{pretty} = 1;
    return $self;
}

sub encode {
    my ($self, $data) = @_;
    return $self->_encode($data, 0);
}

sub _encode {
    my ($self, $data, $depth) = @_;

    return 'null' unless defined $data;

    my $ref = ref $data;

    # Handle boolean objects
    if ($ref eq 'LocalCode::JSON::Boolean') {
        return $$data ? 'true' : 'false';
    }

    if (!$ref) {
        # Scalar
        if ($data =~ /^-?\d+$/ || $data =~ /^-?\d+\.\d+$/) {
            # Number (but not 0 or 1 alone, which could be booleans)
            return $data;
        } else {
            # String - escape special characters
            $data =~ s/\\/\\\\/g;
            $data =~ s/"/\\"/g;
            $data =~ s/\n/\\n/g;
            $data =~ s/\r/\\r/g;
            $data =~ s/\t/\\t/g;
            return qq{"$data"};
        }
    }
    elsif ($ref eq 'ARRAY') {
        return '[]' unless @$data;

        my $indent = $self->{pretty} ? '  ' x ($depth + 1) : '';
        my $newline = $self->{pretty} ? "\n" : '';
        my $space = $self->{pretty} ? ' ' : '';

        my @items = map { $self->_encode($_, $depth + 1) } @$data;
        if ($self->{pretty}) {
            return "[\n$indent" . join(",\n$indent", @items) . "\n" . ('  ' x $depth) . "]";
        } else {
            return '[' . join(',', @items) . ']';
        }
    }
    elsif ($ref eq 'HASH') {
        return '{}' unless %$data;

        my $indent = $self->{pretty} ? '  ' x ($depth + 1) : '';
        my $newline = $self->{pretty} ? "\n" : '';
        my $space = $self->{pretty} ? ' ' : '';

        my @pairs;
        for my $key (sort keys %$data) {
            my $encoded_key = qq{"$key"};
            my $encoded_value = $self->_encode($data->{$key}, $depth + 1);
            push @pairs, "$encoded_key:$space$encoded_value";
        }

        if ($self->{pretty}) {
            return "{\n$indent" . join(",\n$indent", @pairs) . "\n" . ('  ' x $depth) . "}";
        } else {
            return '{' . join(',', @pairs) . '}';
        }
    }
    elsif ($ref eq 'SCALAR') {
        # Boolean references
        return $$data ? 'true' : 'false';
    }
    else {
        die "Cannot encode reference type: $ref";
    }
}

sub decode {
    my ($self, $json) = @_;

    # Remove whitespace
    $json =~ s/^\s+//;
    $json =~ s/\s+$//;

    return $self->_decode($json);
}

sub _decode {
    my ($self, $json) = @_;

    # null
    return undef if $json eq 'null';

    # true/false
    return 1 if $json eq 'true';
    return 0 if $json eq 'false';

    # Numbers
    return $json + 0 if $json =~ /^-?\d+$/;
    return $json + 0.0 if $json =~ /^-?\d+\.\d+$/;

    # Strings
    if ($json =~ /^"(.*)"$/s) {
        my $str = $1;
        # Unescape Unicode sequences first (\uXXXX)
        $str =~ s/\\u([0-9a-fA-F]{4})/chr(hex($1))/eg;
        # Unescape other escape sequences
        $str =~ s/\\n/\n/g;
        $str =~ s/\\r/\r/g;
        $str =~ s/\\t/\t/g;
        $str =~ s/\\"/"/g;
        $str =~ s/\\\\/\\/g;
        return $str;
    }

    # Arrays
    if ($json =~ /^\[(.*)\]$/s) {
        my $content = $1;
        return [] if $content =~ /^\s*$/;

        my @items;
        my $depth = 0;
        my $in_string = 0;
        my $current = '';

        for my $char (split //, $content) {
            if ($char eq '"' && ($current eq '' || substr($current, -1) ne '\\')) {
                $in_string = !$in_string;
                $current .= $char;
            }
            elsif (!$in_string && ($char eq '[' || $char eq '{')) {
                $depth++;
                $current .= $char;
            }
            elsif (!$in_string && ($char eq ']' || $char eq '}')) {
                $depth--;
                $current .= $char;
            }
            elsif (!$in_string && $char eq ',' && $depth == 0) {
                $current =~ s/^\s+|\s+$//g;
                push @items, $self->_decode($current) if $current ne '';
                $current = '';
            }
            else {
                $current .= $char;
            }
        }

        if ($current ne '') {
            $current =~ s/^\s+|\s+$//g;
            push @items, $self->_decode($current);
        }

        return \@items;
    }

    # Objects
    if ($json =~ /^\{(.*)\}$/s) {
        my $content = $1;
        return {} if $content =~ /^\s*$/;

        my %hash;
        my $depth = 0;
        my $in_string = 0;
        my $current = '';

        for my $char (split //, $content) {
            if ($char eq '"' && ($current eq '' || substr($current, -1) ne '\\')) {
                $in_string = !$in_string;
                $current .= $char;
            }
            elsif (!$in_string && ($char eq '[' || $char eq '{')) {
                $depth++;
                $current .= $char;
            }
            elsif (!$in_string && ($char eq ']' || $char eq '}')) {
                $depth--;
                $current .= $char;
            }
            elsif (!$in_string && $char eq ',' && $depth == 0) {
                if ($current =~ /^\s*"([^"]+)"\s*:\s*(.+)$/s) {
                    my ($key, $value) = ($1, $2);
                    $value =~ s/^\s+|\s+$//g;
                    $hash{$key} = $self->_decode($value);
                }
                $current = '';
            }
            else {
                $current .= $char;
            }
        }

        if ($current ne '' && $current =~ /^\s*"([^"]+)"\s*:\s*(.+)$/s) {
            my ($key, $value) = ($1, $2);
            $value =~ s/^\s+|\s+$//g;
            $hash{$key} = $self->_decode($value);
        }

        return \%hash;
    }

    die "Cannot decode JSON: $json";
}

# Boolean package for proper true/false encoding
package LocalCode::JSON::Boolean;
use overload
    '""' => sub { ${$_[0]} ? 'true' : 'false' },
    '0+' => sub { ${$_[0]} ? 1 : 0 },
    'bool' => sub { ${$_[0]} },
    fallback => 1;

1;
