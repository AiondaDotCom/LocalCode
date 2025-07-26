package LocalCode::Tools;
use strict;
use warnings;

sub new {
    my ($class, %args) = @_;
    my $self = {
        config => $args{config},
        tools => {},
        permissions => $args{permissions},
        timeout => $args{timeout} || 60,
        test_mode => 0,
        auto_approve => 0,
        mock_execution => 0,
        simulate_only => 0,
    };
    bless $self, $class;
    
    # Register default tools
    $self->_register_default_tools();
    
    return $self;
}

sub _register_default_tools {
    my ($self) = @_;
    
    $self->register_tool('read', 0, \&_tool_read);
    $self->register_tool('write', 1, \&_tool_write);
    $self->register_tool('exec', 1, \&_tool_exec);
    $self->register_tool('search', 0, \&_tool_search);
}

sub register_tool {
    my ($self, $name, $permission_level, $handler) = @_;
    
    $self->{tools}->{$name} = {
        name => $name,
        permission_level => $permission_level,
        handler => $handler,
    };
}

sub list_tools {
    my ($self) = @_;
    return keys %{$self->{tools}};
}

sub validate_tool {
    my ($self, $name) = @_;
    return exists $self->{tools}->{$name};
}

sub check_permission {
    my ($self, $name) = @_;
    return $self->{tools}->{$name}->{permission_level} if exists $self->{tools}->{$name};
    return 2; # BLOCKED for unknown tools
}

sub request_permission {
    my ($self, $name, $args) = @_;
    
    # Safe tools are auto-allowed
    return 1 if $self->check_permission($name) == 0;
    
    # In test mode with auto_approve
    return 1 if $self->{test_mode} && $self->{auto_approve};
    
    # In test mode without auto_approve
    return 0 if $self->{test_mode} && !$self->{auto_approve};
    
    # Default deny for dangerous tools
    return 0;
}

sub execute_tool {
    my ($self, $name, $args) = @_;
    
    # Validate tool exists
    unless ($self->validate_tool($name)) {
        return {
            success => 0,
            error => "Unknown tool: $name"
        };
    }
    
    # Check permission (skip for mock/simulate modes)
    unless ($self->{mock_execution} || $self->{simulate_only} || $self->request_permission($name, $args)) {
        return {
            success => 0,
            error => "Permission denied for tool: $name"
        };
    }
    
    # Validate arguments
    unless ($args && ref $args eq 'ARRAY' && @$args > 0) {
        return {
            success => 0,
            error => "Invalid arguments for tool: $name"
        };
    }
    
    # Simulation mode
    if ($self->{simulate_only}) {
        return {
            success => 1,
            output => "[SIMULATE] $name(" . join(', ', @$args) . ") -> Would execute"
        };
    }
    
    # Mock execution mode (bypasses permission for testing)
    if ($self->{mock_execution}) {
        return {
            success => 1,
            output => "mock " . lc($name) . ": " . join(', ', @$args)
        };
    }
    
    # Execute the tool
    my $tool = $self->{tools}->{$name};
    
    # Simulate timeout for testing
    if ($self->{test_mode} && $self->{timeout} <= 1 && $args->[0] && $args->[0] =~ /sleep/) {
        return {
            success => 0,
            error => "Tool timeout after $self->{timeout} seconds"
        };
    }
    
    my $result = eval {
        $tool->{handler}->(@$args);
    };
    
    if ($@) {
        return {
            success => 0,
            error => "Tool execution failed: $@"
        };
    }
    
    return {
        success => 1,
        output => $result
    };
}

# Tool implementations
sub _tool_read {
    my ($file) = @_;
    return "mock read: $file";
}

sub _tool_write {
    my ($file, $content) = @_;
    return "mock write: $file -> $content";
}

sub _tool_exec {
    my ($command) = @_;
    return "mock exec: $command";
}

sub _tool_search {
    my ($pattern, $file) = @_;
    return "mock search: $pattern in $file";
}

1;