package LocalCode::Permissions;
use strict;
use warnings;

# Permission levels

sub new {
    my ($class, %args) = @_;
    my $self = {
        config => $args{config},
        permissions => {
            file_read => 0,      # SAFE
            grep_search => 0,    # SAFE  
            file_write => 1,     # DANGEROUS
            shell_exec => 1,     # DANGEROUS
            file_delete => 1,    # DANGEROUS
        },
        remembered_permissions => {},
        remember_choice => 1,
        testing_mode => 'interactive',
        mock_user_input => '',
        custom_rules => {},
    };
    bless $self, $class;
    return $self;
}

sub SAFE { 0 }
sub DANGEROUS { 1 }
sub BLOCKED { 2 }

sub get_permission {
    my ($self, $tool) = @_;
    return $self->{permissions}->{$tool} // 2; # BLOCKED
}

sub set_permission {
    my ($self, $tool, $level) = @_;
    $self->{permissions}->{$tool} = $level;
}

sub is_safe {
    my ($self, $tool) = @_;
    return $self->get_permission($tool) == 0; # SAFE
}

sub is_dangerous {
    my ($self, $tool) = @_;
    return $self->get_permission($tool) == 1; # DANGEROUS
}

sub is_blocked {
    my ($self, $tool) = @_;
    return $self->get_permission($tool) == 2; # BLOCKED
}

sub set_testing_mode {
    my ($self, $mode) = @_;
    $self->{testing_mode} = $mode;
}

sub request_permission {
    my ($self, $tool, $args) = @_;
    
    # Check if tool is blocked
    return 0 if $self->is_blocked($tool);
    
    # Auto-allow safe tools
    return 1 if $self->is_safe($tool);
    
    # Check custom rules
    if (my $rule = $self->{custom_rules}->{$tool}) {
        return $rule->($tool, $args);
    }
    
    # Handle testing modes
    if ($self->{testing_mode} eq 'auto_yes') {
        return 1;
    } elsif ($self->{testing_mode} eq 'auto_no') {
        return 0;
    }
    
    # Check remembered permissions
    if ($self->{remember_choice}) {
        my $key = "$tool:" . join(',', @$args);
        my $global_key = "${tool}:*";
        return $self->{remembered_permissions}->{$key} if exists $self->{remembered_permissions}->{$key};
        return $self->{remembered_permissions}->{$global_key} if exists $self->{remembered_permissions}->{$global_key};
    }
    
    # Interactive mode - use mock input in testing
    if ($self->{mock_user_input}) {
        my $response = $self->{mock_user_input};
        my $result;
        
        if ($response eq 'y') {
            $result = 1;
        } elsif ($response eq 'n') {
            $result = 0;
        } elsif ($response eq 'a') {
            # Always allow - remember this choice for this tool globally
            $result = 1;
            if ($self->{remember_choice}) {
                $self->{remembered_permissions}->{"${tool}:*"} = 1;
            }
        } else {
            $result = 0;
        }
        
        return $result;
    }
    
    # Default deny for dangerous operations
    return 0;
}

sub reset_remembered_permissions {
    my ($self) = @_;
    $self->{remembered_permissions} = {};
}

sub get_safe_tools {
    my ($self) = @_;
    return grep { $self->is_safe($_) } keys %{$self->{permissions}};
}

sub get_dangerous_tools {
    my ($self) = @_;
    return grep { $self->is_dangerous($_) } keys %{$self->{permissions}};
}

sub validate_tool_request {
    my ($self, $tool, $args) = @_;
    
    # Blocked tools always fail
    return 0 if $self->is_blocked($tool);
    
    # Safe tools always pass
    return 1 if $self->is_safe($tool);
    
    # Check custom rules first
    if (my $rule = $self->{custom_rules}->{$tool}) {
        return $rule->($tool, $args);
    }
    
    # Default validation for dangerous tools
    if ($self->is_dangerous($tool)) {
        # Example: block dangerous rm commands
        if ($tool eq 'shell_exec' && $args->[0] =~ /rm.*-rf/) {
            return 0;
        }
        # For other dangerous tools without custom rules, require permission
        return $self->request_permission($tool, $args);
    }
    
    return 1;
}

sub add_custom_rule {
    my ($self, $tool, $rule_sub) = @_;
    $self->{custom_rules}->{$tool} = $rule_sub;
}

1;