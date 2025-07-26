package LocalCode::Session;
use strict;
use warnings;
use JSON;
use File::Spec;

sub new {
    my ($class, %args) = @_;
    my $self = {
        session_dir => $args{session_dir} || 'sessions',
        config => $args{config},
        current_session => undef,
        history => [],
        max_history => $args{max_history} || 100,
    };
    bless $self, $class;
    
    # Create session directory if it doesn't exist
    mkdir $self->{session_dir} unless -d $self->{session_dir};
    
    return $self;
}

sub new_session {
    my ($self, $session_name) = @_;
    
    $self->{current_session} = $session_name;
    $self->{history} = [];
    
    return $session_name;
}

sub add_message {
    my ($self, $role, $content) = @_;
    
    push @{$self->{history}}, {
        role => $role,
        content => $content,
        timestamp => time(),
    };
    
    # Limit history size
    if (@{$self->{history}} > $self->{max_history}) {
        splice @{$self->{history}}, 0, @{$self->{history}} - $self->{max_history};
    }
}

sub get_history {
    my ($self) = @_;
    return @{$self->{history}};
}

sub get_messages_for_chat {
    my ($self, $system_prompt) = @_;
    
    my @messages = ();
    
    # Add system message if provided
    if ($system_prompt) {
        push @messages, {
            role => 'system',
            content => $system_prompt
        };
    }
    
    # Convert history to Ollama chat format
    for my $msg (@{$self->{history}}) {
        # Skip system messages from history (they're for tool feedback)
        next if $msg->{role} eq 'system';
        
        push @messages, {
            role => $msg->{role},
            content => $msg->{content}
        };
    }
    
    return \@messages;
}

sub save_session {
    my ($self, $session_name) = @_;
    
    $session_name ||= $self->{current_session};
    return 0 unless $session_name;
    
    my $session_file = File::Spec->catfile($self->{session_dir}, "$session_name.json");
    
    my $session_data = {
        name => $session_name,
        history => $self->{history},
        created => time(),
    };
    
    open my $fh, '>', $session_file or return 0;
    print $fh JSON->new->pretty->encode($session_data);
    close $fh;
    
    return 1;
}

sub load_session {
    my ($self, $session_name) = @_;
    
    my $session_file = File::Spec->catfile($self->{session_dir}, "$session_name.json");
    return 0 unless -f $session_file;
    
    open my $fh, '<', $session_file or return 0;
    my $json_text = do { local $/; <$fh> };
    close $fh;
    
    my $session_data = eval { JSON->new->decode($json_text) };
    return 0 unless $session_data;
    
    $self->{current_session} = $session_name;
    $self->{history} = $session_data->{history} || [];
    
    return 1;
}

sub list_sessions {
    my ($self) = @_;
    
    return () unless -d $self->{session_dir};
    
    opendir my $dir, $self->{session_dir} or return ();
    my @files = grep { /\.json$/ } readdir $dir;
    closedir $dir;
    
    # Remove .json extension
    return map { s/\.json$//; $_ } @files;
}

sub clear_session {
    my ($self) = @_;
    $self->{history} = [];
}

sub delete_session {
    my ($self, $session_name) = @_;
    
    my $session_file = File::Spec->catfile($self->{session_dir}, "$session_name.json");
    return 0 unless -f $session_file;
    
    return unlink $session_file;
}

sub cleanup_temp_files {
    my ($self) = @_;
    # For now, this is a no-op, but could clean up temporary session files
    return 1;
}

1;