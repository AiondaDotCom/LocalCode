package LocalCode::Tools;
use strict;
use warnings;
use LocalCode::JSON;

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
        # Browser state for web tools
        browser_pages => {},
        browser_stack => [],
        current_page_id => 0,
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
    $self->register_tool('websearch', 0, \&_tool_websearch);
    $self->register_tool('webopen', 0, \&_tool_webopen);
    $self->register_tool('webfind', 0, \&_tool_webfind);
    $self->register_tool('webget', 0, \&_tool_webget);
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
        # Browser tools need $self reference, others don't
        if ($name =~ /^web(search|open|find|get)$/) {
            $tool->{handler}->($self, @$args);
        } else {
            $tool->{handler}->(@$args);
        }
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

    # Check execution permissions before attempting to run
    # Parse command to extract the file being executed
    my $file_to_execute;

    # Handle different command patterns:
    # - ./script.pl
    # - perl script.pl
    # - /path/to/script
    # - script (in PATH)

    if ($command =~ /^\s*\.\/(\S+)/) {
        # Relative path execution: ./script.pl
        $file_to_execute = "./$1";
    } elsif ($command =~ /^\s*(\S+)/) {
        # Extract first word/token which might be a file or command
        my $cmd_token = $1;

        # If it looks like a path (contains / or has file extension) and exists as a file
        if (($cmd_token =~ /\// || $cmd_token =~ /\.\w+$/) && -f $cmd_token) {
            $file_to_execute = $cmd_token;
        }
        # Check for interpreter patterns like "perl script.pl"
        elsif ($command =~ /^\s*(?:perl|python|ruby|bash|sh|node)\s+(\S+)/) {
            $file_to_execute = $1 if -f $1;
        }
        # Check if it's just a local file without path separator
        elsif (-f $cmd_token) {
            $file_to_execute = $cmd_token;
        }
        # Otherwise let it proceed (might be in PATH or will fail naturally)
    }

    # If we identified a local file to execute, check its permissions
    if ($file_to_execute && -f $file_to_execute) {
        # Check if file is executable
        unless (-x $file_to_execute) {
            # Get detailed file permissions
            my @stat_info = stat($file_to_execute);
            my $mode = $stat_info[2];
            my $uid = $stat_info[4];
            my $gid = $stat_info[5];

            # Format permissions in readable format (e.g., rw-r--r--)
            my $perms = sprintf("%04o", $mode & 07777);  # Octal permissions
            my $readable_perms = '';

            # Convert to rwx format
            my $octal = $mode & 0777;
            for my $i (0..2) {
                my $shift = (2 - $i) * 3;
                my $bits = ($octal >> $shift) & 7;
                $readable_perms .= ($bits & 4) ? 'r' : '-';
                $readable_perms .= ($bits & 2) ? 'w' : '-';
                $readable_perms .= ($bits & 1) ? 'x' : '-';
            }

            # Get current user info
            my $current_uid = $<;
            my $current_user = getpwuid($current_uid) || $current_uid;
            my $file_owner = getpwuid($uid) || $uid;
            my $file_group = getgrgid($gid) || $gid;

            # Build detailed error message in English
            my $error_msg = "EXECUTION DENIED: File '$file_to_execute' does not have execute permission.\n\n";
            $error_msg .= "Current permissions: $readable_perms ($perms in octal)\n";
            $error_msg .= "File owner: $file_owner (uid: $uid)\n";
            $error_msg .= "File group: $file_group (gid: $gid)\n";
            $error_msg .= "Current user: $current_user (uid: $current_uid)\n\n";
            $error_msg .= "To fix this, you need to add execute permission. Suggested fix:\n";
            $error_msg .= "  chmod +x $file_to_execute\n\n";
            $error_msg .= "Alternative: Run the file with an interpreter:\n";

            # Suggest appropriate interpreter based on file extension or shebang
            if ($file_to_execute =~ /\.pl$/) {
                $error_msg .= "  perl $file_to_execute";
            } elsif ($file_to_execute =~ /\.py$/) {
                $error_msg .= "  python $file_to_execute";
            } elsif ($file_to_execute =~ /\.rb$/) {
                $error_msg .= "  ruby $file_to_execute";
            } elsif ($file_to_execute =~ /\.sh$/) {
                $error_msg .= "  bash $file_to_execute";
            } elsif ($file_to_execute =~ /\.js$/) {
                $error_msg .= "  node $file_to_execute";
            } else {
                # Try to detect shebang
                if (open my $fh, '<', $file_to_execute) {
                    my $first_line = <$fh>;
                    close $fh;
                    if ($first_line && $first_line =~ /^#!\s*(\S+)/) {
                        my $interpreter = $1;
                        $error_msg .= "  $interpreter $file_to_execute (based on shebang)";
                    } else {
                        $error_msg .= "  bash $file_to_execute (or appropriate interpreter)";
                    }
                }
            }

            return {
                success => 0,
                message => "File lacks execute permission",
                error => $error_msg,
                output => $error_msg
            };
        }
    }

    my $output = `$command 2>&1`;
    my $status = $?;

    # Proper exit code extraction
    my $exit_code = 0;
    if ($status == -1) {
        # Failed to execute
        return {
            success => 0,
            message => "Failed to execute command",
            error => "Failed to execute: $!",
            output => $output
        };
    } elsif ($status & 127) {
        # Died with signal
        my $signal = $status & 127;
        return {
            success => 0,
            message => "Command died with signal $signal",
            error => "Died with signal $signal",
            output => $output,
            exit_code => 128 + $signal
        };
    } else {
        # Normal exit
        $exit_code = $status >> 8;
    }

    # Build detailed error message if command failed
    my $message = $exit_code == 0 ? "Command executed successfully" : "Command failed with exit code $exit_code";

    # If there's output and command failed, include it in the error
    if ($exit_code != 0 && $output) {
        chomp $output;
        $message = "Command failed: $output";
    }

    return {
        success => $exit_code == 0,
        message => $message,
        output => $output,
        exit_code => $exit_code,
        error => $exit_code != 0 ? $output : undef
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

sub _tool_webget {
    my $self = shift;
    my ($query) = @_;
    
    # Step 1: Search
    my $search_result = $self->_tool_websearch($query);
    unless ($search_result->{success}) {
        return $search_result;
    }
    
    # Step 2: Extract first good URL and open it
    my @urls = ($search_result->{content} =~ m{https?://[^\s<>"'()]+}g);
    
    # Clean up URLs
    @urls = map { 
        s/[.,;:!?)\]}>]*$//;  # Remove trailing punctuation
        s/#.*$//;             # Remove fragments
        $_; 
    } @urls;
    
    # Remove duplicates and keep valid URLs  
    my %seen;
    @urls = grep { !$seen{$_}++ && $_ =~ m{^https?://[^/\s]+} } @urls;
    
    unless (@urls) {
        return {
            success => 0,
            error => "No valid URLs found in search results"
        };
    }
    
    # Try the first few URLs until one works, preferring specific pages
    for my $i (0..4) {  # Try more URLs
        last unless $urls[$i];
        
        my $open_result = $self->_tool_webopen($urls[$i]);
        if ($open_result->{success}) {
            # Return the first working URL - no domain-specific filtering
            
            return {
                success => 1,
                message => "Found and opened webpage: $urls[$i]",
                content => $open_result->{content},
                search_query => $query,
                url => $urls[$i],
                page_id => $open_result->{page_id}
            };
        }
    }
    
    return {
        success => 0,
        error => "Could not open any of the found URLs"
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

# Browser Tools Implementation

# Simple URL encoding function (replaces URI::Escape)
sub _url_encode {
    my ($str) = @_;
    $str =~ s/([^A-Za-z0-9\-_.~])/sprintf("%%%02X", ord($1))/ge;
    return $str;
}

sub _tool_websearch {
    my $self = shift;
    my ($query) = @_;

    my $encoded_query = _url_encode($query);
    
    # Try multiple search engines - robust fallback system
    my @search_engines = (
        {
            name => "Mojeek",
            url => "https://www.mojeek.com/search?q=$encoded_query",
            user_agent => "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
        },
        {
            name => "DuckDuckGo HTML",
            url => "https://html.duckduckgo.com/html/?q=$encoded_query",
            user_agent => "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
        },
        {
            name => "Startpage",
            url => "https://www.startpage.com/sp/search?query=$encoded_query",
            user_agent => "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
        },
        {
            name => "Bing",
            url => "https://www.bing.com/search?q=$encoded_query",
            user_agent => "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
        }
    );
    
    my $html_content;
    my $used_engine;
    my $used_url;
    
    for my $engine (@search_engines) {
        my $cmd = qq{curl -s -k -A "$engine->{user_agent}" "$engine->{url}"};
        $html_content = `$cmd 2>/dev/null`;
        my $exit_code = $? >> 8;
        
        if ($exit_code == 0 && $html_content && length($html_content) > 500) {
            # Quick test for meaningful content
            my $test_content = $html_content;
            $test_content =~ s/<script.*?<\/script>//gsi;
            $test_content =~ s/<style.*?<\/style>//gsi;
            $test_content =~ s/<[^>]+>//g;
            $test_content =~ s/\s+/ /g;
            
            # If we got substantial cleaned content, use this engine
            if (length($test_content) > 300) {
                $used_engine = $engine->{name};
                $used_url = $engine->{url};
                last;
            }
        }
    }
    
    unless ($html_content && $used_engine) {
        return {
            success => 0,
            error => "All search engines failed - please check internet connection"
        };
    }
    
    # Clean HTML - remove scripts, styles, and convert to text
    $html_content =~ s/<script.*?<\/script>//gsi;
    $html_content =~ s/<style.*?<\/style>//gsi;
    $html_content =~ s/<noscript.*?<\/noscript>//gsi;
    $html_content =~ s/<!--.*?-->//gs;
    $html_content =~ s/<head.*?<\/head>//gsi;
    
    # Convert HTML entities
    $html_content =~ s/&nbsp;/ /g;
    $html_content =~ s/&amp;/&/g;
    $html_content =~ s/&lt;/</g;
    $html_content =~ s/&gt;/>/g;
    $html_content =~ s/&quot;/"/g;
    $html_content =~ s/&#39;/'/g;
    $html_content =~ s/&#8211;/-/g;
    $html_content =~ s/&#8212;/--/g;
    $html_content =~ s/&#x2715;/x/g;
    $html_content =~ s/&#(\d+);/chr($1)/ge;
    $html_content =~ s/&rsaquo;/>/g;
    
    # Remove all HTML tags
    $html_content =~ s/<[^>]+>//g;
    
    # Clean up whitespace and normalize
    $html_content =~ s/\r\n/\n/g;
    $html_content =~ s/\s+/ /g;
    $html_content =~ s/^\s+|\s+$//g;
    
    # Remove Mojeek-specific navigation noise
    $html_content =~ s/Mojeek User Survey.*?Results \d+ to \d+ from \d+.*?in \d+\.\d+s//gs;
    $html_content =~ s/(SearchWebImagesNewsSubstickCompanyPress|MediaCareersContact|UsProductsMojeekAdsFocusWeb|SearchAPISiteSearchAPI|SimpleSearchBoxes|SupportSupportBrowsersMobile|APIDocsEngageBlogCommunityNewsletter)//g;
    
    # Remove general navigation/footer noise
    $html_content =~ s/(Privacy|Terms|Settings|About|Help|Sign in|Advertisement|Cookie|JavaScript|Enable|Disable|Menu|Navigation|Header|Footer)(\s+\w+)*\s*//gi;
    $html_content =~ s/\b(More results|Related searches|People also ask|Submit feedback|Change|Prev|Next|WebSummaryImagesNews|United Kingdom|Germany|France|European Union|All Regions|Advanced Search|Preferences|Focus|Language None|Safe Search Off|Theme Light)\b\s*//gim;
    
    # Remove duplicate whitespace and clean up
    $html_content =~ s/\s+/ /g;
    $html_content =~ s/^\s+|\s+$//g;
    
    # If content is still too short, provide fallback message
    if (length($html_content) < 200) {
        $html_content = "Search performed for '$query' using $used_engine. Limited results available - search engines may be blocking automated requests. Try more specific search terms.";
    }
    
    # Truncate if too long but keep meaningful content
    if (length($html_content) > 4000) {
        # Try to truncate at sentence boundaries
        my $truncated = substr($html_content, 0, 3800);
        if ($truncated =~ /^(.*\.)\s+\w/) {
            $html_content = $1 . "\n\n[Search results truncated for readability...]";
        } else {
            $html_content = substr($html_content, 0, 3800) . "\n\n[Search results truncated for readability...]";
        }
    }
    
    # Store in browser state
    my $page_id = ++$self->{current_page_id};
    $self->{browser_pages}->{$page_id} = {
        title => "Search: $query",
        url => $used_url,
        content => $html_content,
        type => 'search',
        engine => $used_engine
    };
    push @{$self->{browser_stack}}, $page_id;
    
    # Format clean content for AI interpretation
    my $display = "🔍 Internet Search Results for: $query (via $used_engine)\n\n";
    $display .= $html_content . "\n\n";
    $display .= "[Note: These are real search results from $used_engine. Please extract and interpret the most relevant information.]";
    
    return {
        success => 1,
        message => "Retrieved search results from $used_engine",
        content => $display,
        page_id => $page_id,
        url => $used_url,
        engine => $used_engine
    };
}

sub _tool_webopen {
    my $self = shift;
    my ($url_or_id) = @_;
    
    # Use curl for better SSL support
    
    my $url;
    
    # Check if it's a result ID from search
    if ($url_or_id =~ /^\d+$/) {
        my $current_page = $self->{browser_stack}->[-1];
        if ($current_page && $self->{browser_pages}->{$current_page}) {
            my $page = $self->{browser_pages}->{$current_page};
            if ($page->{type} eq 'search') {
                # Extract URLs from cleaned content - get clean URLs
                my @urls = ($page->{content} =~ m{https?://[^\s<>"'()]+}g);
                
                # Clean up URLs - remove trailing punctuation and fragments
                @urls = map { 
                    s/[.,;:!?)\]}>]*$//;  # Remove trailing punctuation
                    s/#.*$//;             # Remove fragments
                    $_; 
                } @urls;
                
                # Remove duplicates and invalid URLs
                my %seen;
                @urls = grep { !$seen{$_}++ && $_ =~ m{^https?://[^/]+/} } @urls;
                
                my $result_id = int($url_or_id);
                if ($result_id < @urls) {
                    $url = $urls[$result_id];
                }
            }
        }
        
        unless ($url) {
            return {
                success => 0,
                error => "Invalid result ID: $url_or_id. Use webopen with a full URL instead."
            };
        }
    } else {
        $url = $url_or_id;
    }
    
    # Fetch the webpage using curl
    my $content = `curl -s -L -A "LocalCode/1.0" --max-time 30 -k "$url" 2>/dev/null`;
    my $exit_code = $? >> 8;
    
    if ($exit_code != 0) {
        return {
            success => 0,
            error => "Failed to fetch $url: curl exit code $exit_code"
        };
    }
    
    # Simple HTML to text conversion (basic)
    $content =~ s/<script.*?<\/script>//gsi;
    $content =~ s/<style.*?<\/style>//gsi;
    $content =~ s/<[^>]+>//g;
    $content =~ s/&nbsp;/ /g;
    $content =~ s/&amp;/&/g;
    $content =~ s/&lt;/</g;
    $content =~ s/&gt;/>/g;
    $content =~ s/\s+/ /g;
    
    # Truncate if too long
    if (length($content) > 8000) {
        $content = substr($content, 0, 8000) . "\n\n[Content truncated...]";
    }
    
    # Store page
    my $page_id = ++$self->{current_page_id};
    $self->{browser_pages}->{$page_id} = {
        title => 'Web Page',  # curl doesn't provide easy title extraction
        url => $url,
        content => $content,
        type => 'webpage'
    };
    push @{$self->{browser_stack}}, $page_id;
    
    return {
        success => 1,
        message => "Opened webpage: $url",
        content => $content,
        page_id => $page_id,
        url => $url
    };
}

sub _tool_webfind {
    my $self = shift;
    my ($pattern, $page_id) = @_;
    
    # Use current page if no ID specified
    $page_id ||= $self->{browser_stack}->[-1] if @{$self->{browser_stack}};
    
    unless ($page_id && $self->{browser_pages}->{$page_id}) {
        return {
            success => 0,
            error => "No webpage available to search"
        };
    }
    
    my $page = $self->{browser_pages}->{$page_id};
    my $content = $page->{content};
    
    my @matches = ();
    my @lines = split /\n/, $content;
    
    for my $i (0..$#lines) {
        if ($lines[$i] =~ /\Q$pattern\E/i) {
            my $context_start = $i > 2 ? $i - 2 : 0;
            my $context_end = $i + 2 < @lines ? $i + 2 : $#lines;
            
            my $match_context = join("\n", 
                map { sprintf("L%d: %s", $_ + 1, $lines[$_]) } 
                ($context_start..$context_end)
            );
            
            push @matches, {
                line => $i + 1,
                context => $match_context,
                text => $lines[$i]
            };
        }
    }
    
    my $result_text = "🔍 Find results for '$pattern' in " . $page->{title} . "\n\n";
    
    if (@matches) {
        $result_text .= sprintf("Found %d matches:\n\n", scalar(@matches));
        for my $i (0..($#matches < 9 ? $#matches : 9)) {  # Limit to 10 results
            my $match = $matches[$i];
            $result_text .= sprintf("[Match %d at line %d]\n%s\n\n", 
                $i + 1, $match->{line}, $match->{context});
        }
        
        if (@matches > 10) {
            $result_text .= sprintf("... and %d more matches\n", @matches - 10);
        }
    } else {
        $result_text .= "No matches found.\n";
    }
    
    return {
        success => 1,
        message => "Found " . scalar(@matches) . " matches",
        content => $result_text,
        matches => \@matches
    };
}

1;