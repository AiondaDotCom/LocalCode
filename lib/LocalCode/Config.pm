package LocalCode::Config;
use strict;
use warnings;
use YAML::Tiny;
use File::Spec;
use File::Path qw(make_path);

our $VERSION = '1.0.0';

sub new {
    my ($class, %args) = @_;
    my $self = {
        config_file => $args{config_file} || 'config/default.yaml',
        config_data => {},
        home_dir => $ENV{HOME} || $ENV{USERPROFILE} || '.',
        localcode_dir => undef,
    };
    bless $self, $class;
    
    # Create ~/.localcode directory structure
    $self->{localcode_dir} = File::Spec->catdir($self->{home_dir}, '.localcode');
    $self->_ensure_localcode_dir();
    
    $self->_load_config();
    return $self;
}

sub load_defaults {
    my ($self) = @_;
    my $default_file = 'config/default.yaml';
    return $self->load_file($default_file);
}

sub load_file {
    my ($self, $file) = @_;
    return {} unless -f $file;
    
    my $yaml = YAML::Tiny->read($file);
    return {} unless $yaml && $yaml->[0];
    
    my $config = $yaml->[0];
    
    # Convert YAML boolean strings to Perl boolean
    $self->_convert_booleans($config);
    
    return $config;
}

sub _convert_booleans {
    my ($self, $data) = @_;
    return unless ref $data;
    
    if (ref $data eq 'HASH') {
        for my $key (keys %$data) {
            if (ref $data->{$key}) {
                $self->_convert_booleans($data->{$key});
            } elsif (defined $data->{$key}) {
                if ($data->{$key} eq 'true') {
                    $data->{$key} = 1;
                } elsif ($data->{$key} eq 'false') {
                    $data->{$key} = 0;
                }
            }
        }
    } elsif (ref $data eq 'ARRAY') {
        for my $item (@$data) {
            $self->_convert_booleans($item);
        }
    }
}

sub _load_config {
    my ($self) = @_;
    $self->{config_data} = $self->load_file($self->{config_file});
    
    # Merge with defaults if not using default file
    if ($self->{config_file} ne 'config/default.yaml') {
        my $defaults = $self->load_defaults();
        $self->{config_data} = $self->merge($defaults, $self->{config_data});
    }
}

sub validate {
    my ($self, $config) = @_;
    $config ||= $self->{config_data};
    
    return 0 unless ref $config eq 'HASH';
    return 0 unless $config->{ollama};
    return 0 unless defined $config->{ollama}->{host};
    return 0 unless $config->{ollama}->{port} && $config->{ollama}->{port} =~ /^\d+$/;
    
    return 1;
}

# Home directory management
sub _ensure_localcode_dir {
    my ($self) = @_;
    
    unless (-d $self->{localcode_dir}) {
        make_path($self->{localcode_dir}) or die "Cannot create ~/.localcode directory: $!";
    }
    
    # Create subdirectories
    my $sessions_dir = File::Spec->catdir($self->{localcode_dir}, 'sessions');
    make_path($sessions_dir) unless -d $sessions_dir;
}

sub get_localcode_dir {
    my ($self) = @_;
    return $self->{localcode_dir};
}

sub get_sessions_dir {
    my ($self) = @_;
    return File::Spec->catdir($self->{localcode_dir}, 'sessions');
}


sub save_last_model {
    my ($self, $model) = @_;
    my $model_file = File::Spec->catfile($self->{localcode_dir}, 'last_model.txt');
    
    # Trim whitespace before saving
    $model =~ s/^\s+|\s+$//g if $model;
    
    open my $fh, '>', $model_file or warn "Cannot save last model: $!";
    print $fh $model if $fh;
    close $fh if $fh;
}

sub load_last_model {
    my ($self) = @_;
    my $model_file = File::Spec->catfile($self->{localcode_dir}, 'last_model.txt');
    
    return '' unless -f $model_file;
    
    open my $fh, '<', $model_file or return '';
    my $model = <$fh>;
    close $fh;
    
    if ($model) {
        chomp $model;
        $model =~ s/^\s+|\s+$//g;  # Trim whitespace
    }
    return $model || '';
}

sub get_version {
    my ($self) = @_;
    return $VERSION;
}

sub merge {
    my ($self, $defaults, $custom) = @_;
    my %merged = %$defaults;
    
    for my $key (keys %$custom) {
        if (ref $custom->{$key} eq 'HASH' && ref $defaults->{$key} eq 'HASH') {
            $merged{$key} = $self->merge($defaults->{$key}, $custom->{$key});
        } else {
            $merged{$key} = $custom->{$key};
        }
    }
    
    return \%merged;
}

sub get {
    my ($self, $path) = @_;
    my @keys = split /\./, $path;
    my $data = $self->{config_data};
    
    for my $key (@keys) {
        return unless ref $data eq 'HASH' && exists $data->{$key};
        $data = $data->{$key};
    }
    
    return $data;
}

sub set {
    my ($self, $path, $value) = @_;
    my @keys = split /\./, $path;
    my $data = $self->{config_data};
    
    for my $i (0 .. $#keys - 1) {
        my $key = $keys[$i];
        $data->{$key} = {} unless ref $data->{$key} eq 'HASH';
        $data = $data->{$key};
    }
    
    $data->{$keys[-1]} = $value;
}

sub set_testing_mode {
    my ($self, $mode) = @_;
    
    # Reset all testing flags
    $self->set('testing.auto_approve', 0);
    $self->set('testing.auto_deny', 0);
    $self->set('testing.simulate_only', 0);
    $self->set('testing.mock_execution', 0);
    
    if ($mode eq 'auto_yes') {
        $self->set('testing.auto_approve', 1);
    } elsif ($mode eq 'auto_no') {
        $self->set('testing.auto_deny', 1);
    } elsif ($mode eq 'simulate') {
        $self->set('testing.simulate_only', 1);
    } elsif ($mode eq 'mock') {
        $self->set('testing.mock_execution', 1);
    }
}

1;