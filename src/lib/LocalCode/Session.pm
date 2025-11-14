package LocalCode::Session;
use strict;
use warnings;
use LocalCode::JSON;
use File::Spec;
use File::Path qw(make_path);

sub new {
    my ($class, %args) = @_;
    
    # Always use ~/.localcode/sessions unless explicitly overridden (for testing)
    my $default_session_dir = File::Spec->catdir($ENV{HOME}, '.localcode', 'sessions');
    
    my $self = {
        session_dir => $args{session_dir} || $default_session_dir,
        config => $args{config},
        current_session => undef,
        history => [],
        max_history => $args{max_history} || 100,
    };
    bless $self, $class;
    
    # Create session directory if it doesn't exist (including parent directories)
    make_path($self->{session_dir}) unless -d $self->{session_dir};
    
    # Initialize messages array for backward compatibility
    $self->{messages} = [];
    
    return $self;
}

sub new_session {
    my ($self, $session_name) = @_;
    
    $self->{current_session} = $session_name;
    $self->{history} = [];
    
    return $session_name;
}


sub get_history {
    my ($self) = @_;
    return @{$self->{history}};
}

sub get_messages_for_chat {
    my ($self, $system_prompt) = @_;
    
    my @messages = ();
    
    # Add system message if provided (this must always be preserved)
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

sub truncate_history_for_context {
    my ($self, $remove_pairs) = @_;
    
    # Default to removing 3 oldest user/assistant pairs (6 messages)
    $remove_pairs ||= 3;
    my $remove_messages = $remove_pairs * 2;
    
    # Get non-system messages to work with
    my @non_system_history = grep { $_->{role} ne 'system' } @{$self->{history}};
    
    # Only truncate if we have enough messages to remove
    if (@non_system_history > $remove_messages) {
        # Remove the oldest messages (keep everything after the first $remove_messages)
        my @remaining_messages = splice @non_system_history, $remove_messages;
        
        # Rebuild history with system messages preserved and remaining conversation
        my @new_history = ();
        
        # Add back any system messages from the original history
        for my $msg (@{$self->{history}}) {
            if ($msg->{role} eq 'system') {
                push @new_history, $msg;
            }
        }
        
        # Add the remaining non-system messages (oldest removed)
        push @new_history, @remaining_messages;
        
        $self->{history} = \@new_history;
        
        return $remove_messages; # Number of messages removed
    }
    
    return 0; # No messages removed
}

sub compress_history {
    my ($self, $client, $compress_count) = @_;

    $compress_count ||= 6; # Default: compress oldest 6 messages (3 pairs)

    # Get non-system messages to work with
    my @non_system_history = grep { $_->{role} ne 'system' } @{$self->{history}};

    # Need at least $compress_count messages to compress
    return 0 if @non_system_history < $compress_count;

    # Extract the oldest messages to compress
    my @to_compress = splice @non_system_history, 0, $compress_count;

    # Build conversation text for summarization
    my $conversation_text = "";
    for my $msg (@to_compress) {
        my $role = ucfirst($msg->{role});
        $conversation_text .= "$role: $msg->{content}\n\n";
    }

    # Ask the AI to summarize
    my $summary_prompt = "Please provide a concise summary of this conversation, preserving key information, decisions, and context:\n\n$conversation_text";

    my $summary = $client->chat($summary_prompt);

    # Check if summarization was successful
    if (!$summary || $summary =~ /^Error:/) {
        # If summarization fails, fall back to truncation
        return 0;
    }

    # Create a system message with the summary
    my $summary_msg = {
        role => 'system',
        content => "Previous conversation summary: $summary"
    };

    # Rebuild history: keep existing system messages, add summary, keep remaining messages
    my @new_history = ();

    # Add back any existing system messages
    for my $msg (@{$self->{history}}) {
        if ($msg->{role} eq 'system') {
            push @new_history, $msg;
        }
    }

    # Add the summary as a system message
    push @new_history, $summary_msg;

    # Add the remaining non-system messages
    push @new_history, @non_system_history;

    $self->{history} = \@new_history;

    return $compress_count; # Number of messages compressed
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
    print $fh LocalCode::JSON->new->pretty->encode($session_data);
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
    
    my $session_data = eval { LocalCode::JSON->new->decode($json_text) };
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


sub add_message {
    my ($self, $role, $content) = @_;
    
    # Add to session history
    push @{$self->{history}}, {
        role => $role,
        content => $content,
        timestamp => time(),
    };
    
    # Limit session history size
    if (@{$self->{history}} > $self->{max_history}) {
        splice @{$self->{history}}, 0, @{$self->{history}} - $self->{max_history};
    }
    
    # ALSO add to messages array (for backward compatibility with get_messages_for_chat())
    push @{$self->{messages}}, {
        role => $role,
        content => $content,
        timestamp => time()
    };
}

1;