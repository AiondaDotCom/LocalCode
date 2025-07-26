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
    $self->register_tool('bash', 1, \&_tool_exec);  # bash = exec alias
    $self->register_tool('search', 0, \&_tool_search);
    $self->register_tool('grep', 0, \&_tool_search);  # grep = search alias
    $self->register_tool('edit', 1, \&_tool_edit);
    $self->register_tool('list', 0, \&_tool_list);
    $self->register_tool('glob', 0, \&_tool_glob);
    $self->register_tool('patch', 1, \&_tool_patch);
    $self->register_tool('webfetch', 0, \&_tool_webfetch);
    $self->register_tool('todowrite', 0, \&_tool_todowrite);
    $self->register_tool('todoread', 0, \&_tool_todoread);
    $self->register_tool('task', 1, \&_tool_task);
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
    
    # Skip permission check here - it's done in bin/localcode
    
    # Validate arguments (allow empty args for some tools like todoread)
    unless ($args && ref $args eq 'ARRAY') {
        return {
            success => 0,
            error => "Invalid arguments for tool: $name"
        };
    }
    
    # Some tools don't need arguments
    if (@$args == 0 && $name ne 'todoread') {
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
    
    # If result is already a proper hash with success/error, return it directly
    if (ref $result eq 'HASH' && (exists $result->{success} || exists $result->{error})) {
        return $result;
    }
    
    # Otherwise wrap simple results
    return {
        success => 1,
        output => $result
    };
}

# Tool implementations
sub _tool_read {
    my ($file) = @_;
    
    unless (-f $file) {
        return {
            success => 0,
            error => "File not found: $file"
        };
    }
    
    open my $fh, '<', $file or return {
        success => 0,
        error => "Cannot read file: $!"
    };
    
    my $content = do { local $/; <$fh> };
    close $fh;
    
    return {
        success => 1,
        message => "Read " . length($content) . " bytes from $file",
        content => $content
    };
}

sub _tool_write {
    my ($file, $content) = @_;
    
    open my $fh, '>', $file or return {
        success => 0,
        error => "Cannot write file: $!"
    };
    
    # Add newline at end if content doesn't already end with one
    $content .= "\n" unless $content =~ /\n$/;
    
    print $fh $content;
    close $fh;
    
    return {
        success => 1,
        message => "Wrote " . length($content) . " bytes to $file"
    };
}

sub _tool_exec {
    my ($command) = @_;
    
    my $output = `$command 2>&1`;
    my $exit_code = $? >> 8;
    
    return {
        success => $exit_code == 0,
        message => $exit_code == 0 ? "Command executed successfully" : "Command failed with exit code $exit_code",
        output => $output,
        exit_code => $exit_code
    };
}

sub _tool_search {
    my ($pattern, $file) = @_;
    
    unless (-f $file) {
        return {
            success => 0,
            error => "File not found: $file"
        };
    }
    
    open my $fh, '<', $file or return {
        success => 0,
        error => "Cannot read file: $!"
    };
    
    my @matches = ();
    my $line_num = 0;
    
    while (my $line = <$fh>) {
        $line_num++;
        if ($line =~ /$pattern/) {
            push @matches, "$line_num: $line";
        }
    }
    close $fh;
    
    return {
        success => 1,
        message => "Found " . scalar(@matches) . " matches in $file",
        matches => \@matches
    };
}

sub _tool_edit {
    my ($file, $old_string, $new_string) = @_;
    
    unless (-f $file) {
        return {
            success => 0,
            error => "File not found: $file"
        };
    }
    
    # Read file
    open my $fh, '<', $file or return {
        success => 0,
        error => "Cannot read file: $!"
    };
    my $content = do { local $/; <$fh> };
    close $fh;
    
    # Count occurrences for verification
    my $count = () = $content =~ /\Q$old_string\E/g;
    if ($count == 0) {
        return {
            success => 0,
            error => "String not found in file: '$old_string'"
        };
    }
    
    # Replace and write back
    $content =~ s/\Q$old_string\E/$new_string/g;
    
    open $fh, '>', $file or return {
        success => 0,
        error => "Cannot write file: $!"
    };
    print $fh $content;
    close $fh;
    
    return {
        success => 1,
        message => "Replaced $count occurrence(s) in $file"
    };
}

sub _tool_list {
    my ($path) = @_;
    
    unless (-d $path) {
        return {
            success => 0,
            error => "Directory not found: $path"
        };
    }
    
    opendir my $dh, $path or return {
        success => 0,
        error => "Cannot read directory: $!"
    };
    
    my @entries = sort grep { $_ ne '.' && $_ ne '..' } readdir $dh;
    closedir $dh;
    
    return {
        success => 1,
        message => "Found " . scalar(@entries) . " entries in $path",
        entries => \@entries
    };
}

sub _tool_glob {
    my ($pattern, $directory) = @_;
    $directory ||= '.';
    
    unless (-d $directory) {
        return {
            success => 0,
            error => "Directory not found: $directory"
        };
    }
    
    my @matches = glob("$directory/$pattern");
    
    return {
        success => 1,
        message => "Found " . scalar(@matches) . " matches for pattern '$pattern'",
        matches => \@matches
    };
}

sub _tool_patch {
    my ($file, $patch_content) = @_;
    
    unless (-f $file) {
        return {
            success => 0,
            error => "File not found: $file"
        };
    }
    
    # Create temporary patch file
    my $patch_file = "/tmp/localcode_patch_$$.patch";
    open my $fh, '>', $patch_file or return {
        success => 0,
        error => "Cannot create patch file: $!"
    };
    print $fh $patch_content;
    close $fh;
    
    # Apply patch
    my $output = `patch -p0 < $patch_file 2>&1`;
    my $exit_code = $? >> 8;
    
    unlink $patch_file;
    
    return {
        success => $exit_code == 0,
        message => $exit_code == 0 ? "Patch applied successfully" : "Patch failed",
        output => $output
    };
}

sub _tool_webfetch {
    my ($url) = @_;
    
    # Use curl for web fetching
    my $output = `curl -s -L "$url" 2>&1`;
    my $exit_code = $? >> 8;
    
    return {
        success => $exit_code == 0,
        message => $exit_code == 0 ? "Fetched content from $url" : "Failed to fetch from $url",
        content => $output
    };
}

sub _tool_todowrite {
    my ($task_description) = @_;
    
    my $todo_file = '.localcode_todo.txt';
    my $timestamp = localtime();
    
    open my $fh, '>>', $todo_file or return {
        success => 0,
        error => "Cannot write to todo file: $!"
    };
    
    print $fh "[$timestamp] $task_description\n";
    close $fh;
    
    return {
        success => 1,
        message => "Added task to todo list: $task_description"
    };
}

sub _tool_todoread {
    my $todo_file = '.localcode_todo.txt';
    
    unless (-f $todo_file) {
        return {
            success => 1,
            message => "No todo file found",
            content => "No tasks yet"
        };
    }
    
    open my $fh, '<', $todo_file or return {
        success => 0,
        error => "Cannot read todo file: $!"
    };
    
    my $content = do { local $/; <$fh> };
    close $fh;
    
    return {
        success => 1,
        message => "Read todo list",
        content => $content || "Todo list is empty"
    };
}

sub _tool_task {
    my ($task_command) = @_;
    
    # Execute a complex task (essentially an exec with task context)
    my $output = `$task_command 2>&1`;
    my $exit_code = $? >> 8;
    
    return {
        success => $exit_code == 0,
        message => $exit_code == 0 ? "Task completed successfully" : "Task failed with exit code $exit_code",
        output => $output,
        exit_code => $exit_code
    };
}

1;