package LocalCode::Client;
use strict;
use warnings;
use JSON;
use LWP::UserAgent;

sub new {
    my ($class, %args) = @_;
    my $self = {
        config => $args{config},
        host => $args{host} || 'localhost',
        port => $args{port} || 11434,
        timeout => $args{timeout} || 120,
        current_model => undef,
        default_model => 'qwen2.5:32b',
        available_models => [],
        mock_mode => 0,
        mock_models => [],
        ua => LWP::UserAgent->new(timeout => $args{timeout} || 120),
        status => 'disconnected',
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
        my $data = eval { JSON->new->decode($response->content) };
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
    my ($self, $prompt, $model) = @_;
    
    $model ||= $self->{current_model};
    return "Error: No model selected" unless $model;
    
    if ($self->{mock_mode}) {
        # Simulate timeout for testing
        if ($self->{timeout} <= 1 && $prompt =~ /slow/i) {
            return "Error: Request timeout after $self->{timeout} seconds";
        }
        return "mock response from $model: $prompt";
    }
    
    my $url = "http://$self->{host}:$self->{port}/api/generate";
    my $payload = {
        model => $model,
        prompt => $prompt,
        stream => JSON::false,
    };
    
    my $response = $self->{ua}->post(
        $url,
        'Content-Type' => 'application/json',
        Content => JSON->new->encode($payload)
    );
    
    if ($response->is_success) {
        my $data = eval { JSON->new->decode($response->content) };
        return $data->{response} if $data && $data->{response};
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

sub stream_response {
    my ($self, $prompt) = @_;
    # For now, just return regular response
    # In a full implementation, this would handle streaming
    return $self->chat($prompt);
}

1;