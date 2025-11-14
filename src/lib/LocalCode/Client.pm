package LocalCode::Client;
use strict;
use warnings;
use LocalCode::JSON;
use LocalCode::HTTP;

sub new {
    my ($class, %args) = @_;
    my $self = {
        config => $args{config},
        host => $args{host} || 'localhost',
        port => $args{port} || 11434,
        timeout => $args{timeout} || 120,
        current_model => undef,
        default_model => 'codellama:latest',
        available_models => [],
        mock_mode => 0,
        mock_models => [],
        ua => LocalCode::HTTP->new(timeout => $args{timeout} || 120),
        status => 'disconnected',
        # Context tracking
        context_window => 0,      # num_ctx from model
        prompt_tokens => 0,        # prompt_eval_count
        completion_tokens => 0,    # eval_count
        total_tokens => 0,         # prompt_tokens + completion_tokens
    };
    bless $self, $class;
    
    if ($self->{config}) {
        $self->{host} = $self->{config}->get('ollama.host') || $self->{host};
        $self->{port} = $self->{config}->get('ollama.port') || $self->{port};
        $self->{default_model} = $self->{config}->get('ollama.default_model') || $self->{default_model};
        $self->{timeout} = $self->{config}->get('ollama.timeout') || $self->{timeout};
    }
    
    return $self;
}

sub connect {
    my ($self) = @_;
    
    if ($self->{mock_mode}) {
        $self->{status} = 'connected';
        $self->detect_available_models();
        $self->initialize_current_model();
        return 1;
    }
    
    my $url = "http://$self->{host}:$self->{port}/api/tags";
    my $response = $self->{ua}->get($url);
    
    if ($response->is_success) {
        $self->{status} = 'connected';
        $self->detect_available_models();
        $self->initialize_current_model();
        return 1;
    }
    
    $self->{status} = 'disconnected';
    return 0;
}

sub disconnect {
    my ($self) = @_;
    $self->{status} = 'disconnected';
}

sub get_status {
    my ($self) = @_;
    return $self->{status};
}

sub detect_available_models {
    my ($self) = @_;
    
    if ($self->{mock_mode}) {
        $self->{available_models} = [@{$self->{mock_models}}];
        return @{$self->{available_models}};
    }
    
    my $url = "http://$self->{host}:$self->{port}/api/tags";
    my $response = $self->{ua}->get($url);
    
    if ($response->is_success) {
        my $data = eval { LocalCode::JSON->new->decode($response->content) };
        if ($data && $data->{models}) {
            $self->{available_models} = [map { $_->{name} } @{$data->{models}}];
        }
    }
}

sub list_models {
    my ($self) = @_;
    
    # Auto-detect models if not done yet
    if (@{$self->{available_models}} == 0 && $self->{mock_mode}) {
        $self->detect_available_models();
    }
    
    # Return alphabetically sorted models
    return sort @{$self->{available_models}};
}

sub validate_model {
    my ($self, $model) = @_;
    
    # Auto-detect models if not done yet
    if (@{$self->{available_models}} == 0 && $self->{mock_mode}) {
        $self->detect_available_models();
    }
    
    return grep { $_ eq $model } @{$self->{available_models}};
}

sub is_model_available {
    my ($self, $model) = @_;
    return $self->validate_model($model);
}

sub set_default_model {
    my ($self, $model) = @_;
    $self->{default_model} = $model;
    return 1;
}

sub get_default_model {
    my ($self) = @_;
    return $self->{default_model};
}

sub initialize_current_model {
    my ($self) = @_;
    
    # Use current_model from config if available and valid
    if ($self->{config}) {
        my $config_model = $self->{config}->get('ollama.current_model');
        if ($config_model && $self->validate_model($config_model)) {
            $self->{current_model} = $config_model;
            return 1;
        }
    }
    
    # Fall back to default model
    if ($self->validate_model($self->{default_model})) {
        $self->{current_model} = $self->{default_model};
        return 1;
    }
    
    # Use first available model
    if (@{$self->{available_models}}) {
        $self->{current_model} = $self->{available_models}->[0];
        return 1;
    }
    
    return 0;
}

sub set_model {
    my ($self, $model) = @_;
    
    if ($self->validate_model($model)) {
        $self->{current_model} = $model;
        return 1;
    }
    
    # For invalid models, don't fallback - just return false
    return 0;
}

sub get_current_model {
    my ($self) = @_;
    return $self->{current_model};
}

sub restore_model {
    my ($self, $model) = @_;
    return $self->set_model($model);
}

sub chat {
    my ($self, $prompt, $model, $messages) = @_;
    
    $model ||= $self->{current_model};
    return "Error: No model selected" unless $model;
    
    if ($self->{mock_mode}) {
        # Simulate timeout for testing
        if ($self->{timeout} <= 1 && $prompt =~ /slow/i) {
            return "Error: Request timeout after $self->{timeout} seconds";
        }
        return "mock response from $model: $prompt";
    }
    
    my $url = "http://$self->{host}:$self->{port}/api/chat";
    my $payload = {
        model => $model,
        messages => $messages || [{ role => 'user', content => $prompt }],
        stream => $LocalCode::JSON::false,  # false boolean in JSON
    };
    
    # Call the common chat implementation
    return $self->_chat_request($url, $payload);
}


sub _chat_request {
    my ($self, $url, $payload) = @_;
    
    my $model = $payload->{model};  # Get model from payload
    
    my $response = $self->{ua}->post(
        $url,
        'Content-Type' => 'application/json',
        Content => LocalCode::JSON->new->encode($payload)
    );
    
    if ($response->is_success) {
        my $data = eval { LocalCode::JSON->new->decode($response->content) };
        if ($data) {
            # Update context tracking from response
            $self->{prompt_tokens} = $data->{prompt_eval_count} || 0;
            $self->{completion_tokens} = $data->{eval_count} || 0;
            $self->{total_tokens} = $self->{prompt_tokens} + $self->{completion_tokens};

            # Handle different Ollama response formats
            if ($data->{message} && exists $data->{message}->{content}) {
                my $content = $data->{message}->{content};

                # For gpt-oss models, include thinking if available
                if ($model =~ /gpt-oss/ && $data->{message}->{thinking}) {
                    $content = "**Thinking...**\n" . $data->{message}->{thinking} . "\n\n**Response:**\n" . $content;
                }

                return $content;
            } elsif ($data->{response}) {
                # Fallback to old /api/generate format
                return $data->{response};
            } elsif (exists $data->{content}) {
                # Another possible format - check for thinking field too
                my $content = $data->{content};
                if ($model =~ /gpt-oss/ && $data->{thinking}) {
                    $content = "**Thinking...**\n" . $data->{thinking} . "\n\n**Response:**\n" . $content;
                }
                return $content;
            } else {
                # Debug: show what we actually got
                return "Error: Unexpected response format. Got: " . substr($response->content, 0, 200) . "...";
            }
        } else {
            return "Error: Invalid JSON response from Ollama";
        }
    }
    
    # Check for context length exceeded error
    if (!$response->is_success) {
        my $error_data = eval { LocalCode::JSON->new->decode($response->content) };
        if ($error_data && $error_data->{error} && $error_data->{error} =~ /context length exceeded/i) {
            return { error => 'context_length_exceeded', raw_error => $error_data->{error} };
        }
    }
    
    # Handle timeout
    if ($response->code == 500 && $response->message =~ /timeout/i) {
        return "Error: Request timeout after $self->{timeout} seconds";
    }
    
    return "Error: " . $response->status_line;
}


sub generate {
    my ($self, $prompt) = @_;
    return $self->chat($prompt);
}

# Get model information including context window size
sub get_model_info {
    my ($self, $model) = @_;

    $model ||= $self->{current_model};
    return undef unless $model;

    if ($self->{mock_mode}) {
        return {
            num_ctx => 4096,  # Mock context window
            model => $model,
        };
    }

    my $url = "http://$self->{host}:$self->{port}/api/show";
    my $payload = {
        name => $model,
    };

    my $response = $self->{ua}->post(
        $url,
        'Content-Type' => 'application/json',
        Content => LocalCode::JSON->new->encode($payload)
    );

    if ($response->is_success) {
        my $data = eval { LocalCode::JSON->new->decode($response->content) };
        if ($data) {
            # Extract num_ctx from various possible locations in Ollama response
            my $num_ctx = 4096;  # Default fallback

            # Try different paths where num_ctx might be
            if ($data->{model_info} && $data->{model_info}->{num_ctx}) {
                $num_ctx = $data->{model_info}->{num_ctx};
            } elsif ($data->{model_info} && ref($data->{model_info}) eq 'HASH') {
                # Look for 'num_ctx' in any nested structure
                for my $key (keys %{$data->{model_info}}) {
                    if (ref($data->{model_info}->{$key}) eq 'HASH' && $data->{model_info}->{$key}->{num_ctx}) {
                        $num_ctx = $data->{model_info}->{$key}->{num_ctx};
                        last;
                    }
                }
            }

            # Store it for this model
            $self->{context_window} = $num_ctx;

            return {
                num_ctx => $num_ctx,
                model => $model,
                data => $data,
            };
        }
    }

    # Even if request fails, set a default context window
    $self->{context_window} = 4096;
    return undef;
}

# Get context usage statistics
sub get_context_stats {
    my ($self) = @_;

    return {
        context_window => $self->{context_window} || 0,
        prompt_tokens => $self->{prompt_tokens} || 0,
        completion_tokens => $self->{completion_tokens} || 0,
        total_tokens => $self->{total_tokens} || 0,
        percentage => $self->{context_window} > 0
            ? int(($self->{total_tokens} / $self->{context_window}) * 100)
            : 0,
    };
}


1;