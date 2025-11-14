package LocalCode::ReadLine;
use strict;
use warnings;
use File::Spec;

# Term::ReadLine wrapper with fallback to simple readline
# Tries to use Term::ReadLine::Gnu if available for full features

sub new {
    my ($class, $name) = @_;

    my $self = bless {
        name => $name,
        history => [],
        history_file => undef,
        completion_function => undef,
        attribs => undef,
        term => undef,
        use_term_readline => 0,
    }, $class;

    # Try to load Term::ReadLine (comes with Perl core)
    eval {
        require Term::ReadLine;
        $self->{term} = Term::ReadLine->new($name);
        $self->{use_term_readline} = 1;
        $self->{attribs} = $self->{term}->Attribs if $self->{term}->can('Attribs');
    };

    # If Term::ReadLine failed, use fallback attribs
    if ($@ || !$self->{attribs}) {
        $self->{use_term_readline} = 0;
        $self->{attribs} = LocalCode::ReadLine::Attribs->new();
    }

    return $self;
}

sub readline {
    my ($self, $prompt) = @_;

    # Use Term::ReadLine if available (gives us history, tab completion, etc.)
    if ($self->{use_term_readline} && $self->{term}) {
        my $input = $self->{term}->readline($prompt);
        return undef unless defined $input;
        chomp $input if defined $input;
        return $input;
    }

    # Fallback: Simple approach using standard Perl input
    print $prompt if $prompt;
    my $input = <STDIN>;
    return undef unless defined $input;
    chomp $input;
    return $input;
}

sub add_history {
    my ($self, $line) = @_;
    return unless defined $line && $line ne '';

    # Use Term::ReadLine's history if available
    if ($self->{use_term_readline} && $self->{term}) {
        $self->{term}->addhistory($line);
        return;
    }

    # Fallback: Store in our own history array
    return if @{$self->{history}} && $self->{history}->[-1] eq $line;
    push @{$self->{history}}, $line;
}

sub ReadHistory {
    my ($self, $file) = @_;
    $self->{history_file} = $file;

    return unless -f $file;

    # Use Term::ReadLine's history file support if available
    if ($self->{use_term_readline} && $self->{term} && $self->{term}->can('ReadHistory')) {
        $self->{term}->ReadHistory($file);
        return;
    }

    # Fallback: Read history manually
    open my $fh, '<', $file or return;
    while (my $line = <$fh>) {
        chomp $line;
        $self->add_history($line) if $line ne '';
    }
    close $fh;
}

sub WriteHistory {
    my ($self, $file) = @_;
    $file ||= $self->{history_file};
    return unless $file;

    # Use Term::ReadLine's history file support if available
    if ($self->{use_term_readline} && $self->{term} && $self->{term}->can('WriteHistory')) {
        $self->{term}->WriteHistory($file);
        return;
    }

    # Fallback: Write history manually
    open my $fh, '>', $file or return;
    for my $line (@{$self->{history}}) {
        print $fh "$line\n";
    }
    close $fh;
}

sub clear_history {
    my ($self) = @_;
    $self->{history} = [];
}

sub ornaments {
    my ($self, $value) = @_;
    # Ignore ornaments - we don't support them
    return 0;
}

sub Attribs {
    my ($self) = @_;
    # Return Term::ReadLine's attribs if available
    if ($self->{use_term_readline} && $self->{term} && $self->{term}->can('Attribs')) {
        return $self->{term}->Attribs;
    }
    return $self->{attribs};
}

package LocalCode::ReadLine::Attribs;
use strict;
use warnings;

# Minimal attribs object for compatibility

sub new {
    my ($class) = @_;
    return bless {
        completion_function => undef,
        keymap => 'emacs',
    }, $class;
}

1;
