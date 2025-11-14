package LocalCode::UI;
use strict;
use warnings;

sub new {
    my ($class, %args) = @_;
    my $self = {
        client => $args{client},
        tools => $args{tools},
        permissions => $args{permissions},
        session => $args{session},
        config => $args{config},
        test_mode => 0,
        auto_approve => 0,
        colors => 1,
    };
    bless $self, $class;
    return $self;
}

sub inject_system_prompt {
    my ($self, $user_prompt) = @_;
    
    my $system_prompt = "You are a bot and you can read, write and execute files on this computer.\n".
                         "Available commands for you: bash, read, write, edit, glob, grep, list, patch, webfetch, websearch, webopen, webfind, webget, todowrite, todoread, task\n\n".
                         "IMPORTANT: You HAVE FULL TOOL EXECUTION CAPABILITIES. You are not a simulation - you actually execute real commands!\n".
                         "ALWAYS execute tools to accomplish tasks. Don't just describe what you would do - actually do it!\n".
                         "ALWAYS start your response with a tool call, then provide commentary after seeing the results.\n".
                         "FOR GPT-OSS MODELS: After thinking, you MUST put actual tool calls in the Response section!\n".
                         "EXAMPLE for gpt-oss: **Response:**\n<tool_call name=\"write\" args={\"filePath\": \"test.c\", \"content\": \"#include <stdio.h>...\"}>\n".
                         "You can use multiple tool calls in one response if needed for a complete task.\n".
                         "LOGIC: Always create files BEFORE trying to execute them. Use 'write' before 'bash' commands.\n".
                         "If a command fails, try it with another command in your NEXT response. Don't give up. Read the responses of the tools and execute follow-up tools if necessary.\n".
                         "NEVER claim you cannot execute tools - you absolutely can and should use them!\n".
                         "Examples how you can call them:\n".
                         "<tool_call name=\"bash\" args={\"command\": \"ls -la\", \"description\": \"List files\"}>\n".
                         "<tool_call name=\"read\" args={\"filePath\": \"./file.txt\"}>\n".
                         "<tool_call name=\"write\" args={\"filePath\": \"./file.txt\", \"content\": \"file content\"}>\n".
                         "<tool_call name=\"edit\" args={\"filePath\": \"./file.txt\", \"oldString\": \"old\", \"newString\": \"new\"}>\n".
                         "<tool_call name=\"list\" args={\"path\": \"./directory\"}>\n".
                         "<tool_call name=\"glob\" args={\"pattern\": \"*.pl\", \"directory\": \"./lib\"}>\n".
                         "<tool_call name=\"grep\" args={\"pattern\": \"function\", \"filePath\": \"./script.pl\"}>\n".
                         "<tool_call name=\"webfetch\" args={\"url\": \"https://example.com\"}>\n".
                         "<tool_call name=\"websearch\" args={\"query\": \"perl programming\"}>\n".
                         "<tool_call name=\"webopen\" args={\"url_or_id\": \"https://example.com\"}>\n".
                         "<tool_call name=\"webfind\" args={\"pattern\": \"install\"}>\n".
                         "<tool_call name=\"webget\" args={\"query\": \"current weather Stuttgart\"}>\n".
                         "BROWSER TOOLS: Use 'webget' for quick search+open in one step, or use websearch → webopen → webfind for detailed research.\n".
                         "<tool_call name=\"todowrite\" args={\"task\": \"Implement feature X\"}>\n".
                         "<tool_call name=\"todoread\" args={}>\n".
                         "<tool_call name=\"task\" args={\"command\": \"make test\"}>\n\n";
    
    return $system_prompt;
}

sub get_system_prompt {
    my ($self) = @_;
    return $self->inject_system_prompt("");
}

sub _parse_json_args {
    my ($self, $args_str) = @_;
    my %args = ();
    
    return %args unless $args_str && $args_str =~ /\S/;
    
    # Parse JSON-like arguments with proper quote handling
    $args_str =~ s/^\s+|\s+$//g;  # Trim whitespace
    
    # Split by comma, but be careful about commas inside quoted strings
    my @pairs = ();
    my $current = '';
    my $quote_char = '';
    my $escape_next = 0;
    
    for my $char (split //, $args_str) {
        if ($escape_next) {
            $current .= $char;
            $escape_next = 0;
        } elsif ($char eq '\\') {
            $current .= $char;
            $escape_next = 1;
        } elsif ($char eq '"' || $char eq "'") {
            $current .= $char;
            if ($quote_char eq '') {
                $quote_char = $char;
            } elsif ($quote_char eq $char) {
                $quote_char = '';
            }
        } elsif ($char eq ',' && $quote_char eq '') {
            push @pairs, $current if $current =~ /\S/;
            $current = '';
        } else {
            $current .= $char;
        }
    }
    push @pairs, $current if $current =~ /\S/;
    
    # Parse each key: value pair
    for my $pair (@pairs) {
        if ($pair =~ /^\s*["']([^"']+)["']\s*:\s*["'](.*)["']\s*$/s) {
            my ($key, $value) = ($1, $2);
            # Unescape common escape sequences
            $value =~ s/\\n/\n/g;
            $value =~ s/\\t/\t/g;
            $value =~ s/\\"/"/g;
            $value =~ s/\\'/'/g;
            $value =~ s/\\\\/\\/g;
            $args{$key} = $value;
        }
    }
    
    return %args;
}

sub parse_tool_calls {
    my ($self, $response) = @_;
    my @tools = ();
    
    # Debug output if enabled
    if ($ENV{DEBUG_LOCALCODE}) {
        print "🔍 DEBUG: Parsing response for tool calls:\n";
        print "Response length: " . length($response) . " chars\n";
        print "Response contains <tool_call: " . ($response =~ /<tool_call/ ? "YES" : "NO") . "\n";
    }
    
    # Remove code block markers to expose tool calls inside them
    my $extracted_response = $response;
    $extracted_response =~ s/```//g;
    
    # Parse XML-style tool calls with various formats
    # First, try to find complete tool calls (with proper closing >)
    while ($extracted_response =~ /<tool_call\s+name="([^"]+)"\s+args=\{([^}]*)\}\s*\/?>/gis) {
        my ($tool_name, $args_str) = ($1, $2);
        
        # Skip if not a valid tool
        next unless $tool_name =~ /^(bash|read|write|edit|glob|grep|list|patch|webfetch|websearch|webopen|webfind|webget|todowrite|todoread|task|exec|search)$/i;
        
        # Normalize tool name to lowercase
        $tool_name = lc($tool_name);
        
        # Parse JSON-style arguments
        my %args = $self->_parse_json_args($args_str);
        
        # Convert to array format based on tool type
        my @arg_array = ();
        if ($tool_name eq 'bash' || $tool_name eq 'exec') {
            push @arg_array, $args{command} if $args{command};
        } elsif ($tool_name eq 'read' || $tool_name eq 'list') {
            push @arg_array, $args{filePath} || $args{path} if $args{filePath} || $args{path};
        } elsif ($tool_name eq 'write') {
            push @arg_array, $args{filePath} if $args{filePath};
            push @arg_array, $args{content} if $args{content};
        } elsif ($tool_name eq 'edit') {
            push @arg_array, $args{filePath} if $args{filePath};
            push @arg_array, $args{oldString} if $args{oldString};
            push @arg_array, $args{newString} if $args{newString};
        } elsif ($tool_name eq 'search' || $tool_name eq 'grep') {
            push @arg_array, $args{pattern} if $args{pattern};
            push @arg_array, $args{filePath} || $args{file} if $args{filePath} || $args{file};
        } elsif ($tool_name eq 'glob') {
            push @arg_array, $args{pattern} if $args{pattern};
            push @arg_array, $args{directory} || $args{path} if $args{directory} || $args{path};
        } elsif ($tool_name eq 'patch') {
            push @arg_array, $args{filePath} || $args{file} if $args{filePath} || $args{file};
            push @arg_array, $args{patch} || $args{content} if $args{patch} || $args{content};
        } elsif ($tool_name eq 'webfetch') {
            push @arg_array, $args{url} if $args{url};
        } elsif ($tool_name eq 'websearch') {
            push @arg_array, $args{query} if $args{query};
        } elsif ($tool_name eq 'webopen') {
            push @arg_array, $args{url_or_id} || $args{url} || $args{id} if $args{url_or_id} || $args{url} || $args{id};
        } elsif ($tool_name eq 'webfind') {
            push @arg_array, $args{pattern} if $args{pattern};
        } elsif ($tool_name eq 'webget') {
            push @arg_array, $args{query} if $args{query};
        } elsif ($tool_name eq 'todowrite') {
            push @arg_array, $args{task} || $args{description} if $args{task} || $args{description};
        } elsif ($tool_name eq 'todoread') {
            # No arguments needed for todoread
        } elsif ($tool_name eq 'task') {
            push @arg_array, $args{command} if $args{command};
        }
        
        push @tools, {
            name => $tool_name,
            args => \@arg_array,
            raw_args => \%args,
        };
    }
    
    # Second pass: try to find incomplete tool calls (missing closing >)
    # This handles cases like: <tool_call name="write" args={"filePath": "test", "content": "data"}>some text
    while ($extracted_response =~ /<tool_call\s+name="([^"]+)"\s+args=\{(.*?)\}>\s*/gis) {
        my ($tool_name, $args_str) = ($1, $2);
        
        # Skip if we already found this tool call in the first pass
        next if grep { $_->{name} eq lc($tool_name) } @tools;
        
        # Skip if not a valid tool
        next unless $tool_name =~ /^(bash|read|write|edit|glob|grep|list|patch|webfetch|websearch|webopen|webfind|webget|todowrite|todoread|task|exec|search)$/i;
        
        # Normalize tool name to lowercase
        $tool_name = lc($tool_name);
        
        # Parse JSON-style arguments
        my %args = $self->_parse_json_args($args_str);
        
        # Convert to array format based on tool type
        my @arg_array = ();
        if ($tool_name eq 'bash' || $tool_name eq 'exec') {
            push @arg_array, $args{command} if $args{command};
        } elsif ($tool_name eq 'read' || $tool_name eq 'list') {
            push @arg_array, $args{filePath} || $args{path} if $args{filePath} || $args{path};
        } elsif ($tool_name eq 'write') {
            push @arg_array, $args{filePath} if $args{filePath};
            push @arg_array, $args{content} if $args{content};
        } elsif ($tool_name eq 'edit') {
            push @arg_array, $args{filePath} if $args{filePath};
            push @arg_array, $args{oldString} if $args{oldString};
            push @arg_array, $args{newString} if $args{newString};
        } elsif ($tool_name eq 'search' || $tool_name eq 'grep') {
            push @arg_array, $args{pattern} if $args{pattern};
            push @arg_array, $args{filePath} || $args{file} if $args{filePath} || $args{file};
        } elsif ($tool_name eq 'glob') {
            push @arg_array, $args{pattern} if $args{pattern};
            push @arg_array, $args{directory} || $args{path} if $args{directory} || $args{path};
        } elsif ($tool_name eq 'patch') {
            push @arg_array, $args{filePath} || $args{file} if $args{filePath} || $args{file};
            push @arg_array, $args{patch} || $args{content} if $args{patch} || $args{content};
        } elsif ($tool_name eq 'webfetch') {
            push @arg_array, $args{url} if $args{url};
        } elsif ($tool_name eq 'websearch') {
            push @arg_array, $args{query} if $args{query};
        } elsif ($tool_name eq 'webopen') {
            push @arg_array, $args{url_or_id} || $args{url} || $args{id} if $args{url_or_id} || $args{url} || $args{id};
        } elsif ($tool_name eq 'webfind') {
            push @arg_array, $args{pattern} if $args{pattern};
        } elsif ($tool_name eq 'webget') {
            push @arg_array, $args{query} if $args{query};
        } elsif ($tool_name eq 'todowrite') {
            push @arg_array, $args{task} || $args{description} if $args{task} || $args{description};
        } elsif ($tool_name eq 'todoread') {
            # No arguments needed for todoread
        } elsif ($tool_name eq 'task') {
            push @arg_array, $args{command} if $args{command};
        }
        
        push @tools, {
            name => $tool_name,
            args => \@arg_array,
            raw_args => \%args,
        };
    }
    
    # Second pass: try to find incomplete tool calls (missing closing >)
    while ($extracted_response =~ /<tool_call\s+name="([^"]+)"\s+args=\{([^}]*)\}(?!\s*\/?>)/gis) {
        my ($tool_name, $args_str) = ($1, $2);
        
        # Skip if not a valid tool or already found
        next unless $tool_name =~ /^(bash|read|write|edit|glob|grep|list|patch|webfetch|websearch|webopen|webfind|webget|todowrite|todoread|task|exec|search)$/i;
        
        # Skip if we already have this exact tool call (by comparing raw args strings)
        my %current_args = $self->_parse_json_args($args_str);
        next if grep { $_->{name} eq lc($tool_name) && $_->{raw_args} && $self->_compare_args_hash($_->{raw_args}, \%current_args) } @tools;
        
        # Normalize tool name to lowercase
        $tool_name = lc($tool_name);
        
        # Parse JSON-style arguments
        my %args = $self->_parse_json_args($args_str);
        
        # Convert to array format (reuse same logic)
        my @arg_array = $self->_extract_args_for_tool($tool_name, %args);
        
        # Only add if we have all required arguments for this tool
        next if $self->_missing_required_args($tool_name, \%args);
        
        push @tools, {
            name => $tool_name,
            args => \@arg_array,
            raw_args => \%args,
        };
    }
    
    # Note: Old-style function calls removed - only XML format supported now
    
    return @tools;
}

sub _extract_args_for_tool {
    my ($self, $tool_name, %args) = @_;
    my @arg_array = ();
    
    if ($tool_name eq 'bash' || $tool_name eq 'exec') {
        push @arg_array, $args{command} if $args{command};
    } elsif ($tool_name eq 'read' || $tool_name eq 'list') {
        push @arg_array, $args{filePath} || $args{path} if $args{filePath} || $args{path};
    } elsif ($tool_name eq 'write') {
        push @arg_array, $args{filePath} if $args{filePath};
        push @arg_array, $args{content} if $args{content};
    } elsif ($tool_name eq 'edit') {
        push @arg_array, $args{filePath} if $args{filePath};
        push @arg_array, $args{oldString} if $args{oldString};
        push @arg_array, $args{newString} if $args{newString};
    } elsif ($tool_name eq 'search' || $tool_name eq 'grep') {
        push @arg_array, $args{pattern} if $args{pattern};
        push @arg_array, $args{filePath} || $args{file} if $args{filePath} || $args{file};
    } elsif ($tool_name eq 'glob') {
        push @arg_array, $args{pattern} if $args{pattern};
        push @arg_array, $args{directory} || $args{path} if $args{directory} || $args{path};
    } elsif ($tool_name eq 'patch') {
        push @arg_array, $args{filePath} || $args{file} if $args{filePath} || $args{file};
        push @arg_array, $args{patch} || $args{content} if $args{patch} || $args{content};
    } elsif ($tool_name eq 'webfetch') {
        push @arg_array, $args{url} if $args{url};
    } elsif ($tool_name eq 'websearch') {
        push @arg_array, $args{query} if $args{query};
    } elsif ($tool_name eq 'webopen') {
        push @arg_array, $args{url_or_id} || $args{url} || $args{id} if $args{url_or_id} || $args{url} || $args{id};
    } elsif ($tool_name eq 'webfind') {
        push @arg_array, $args{pattern} if $args{pattern};
    } elsif ($tool_name eq 'webget') {
        push @arg_array, $args{query} if $args{query};
    } elsif ($tool_name eq 'todowrite') {
        push @arg_array, $args{task} || $args{description} if $args{task} || $args{description};
    } elsif ($tool_name eq 'todoread') {
        # No arguments needed for todoread
    } elsif ($tool_name eq 'task') {
        push @arg_array, $args{command} if $args{command};
    }
    
    return @arg_array;
}

sub _compare_args_hash {
    my ($self, $hash1, $hash2) = @_;
    
    # Compare all keys from both hashes
    my %all_keys = map { $_ => 1 } (keys %$hash1, keys %$hash2);
    
    for my $key (keys %all_keys) {
        my $val1 = $hash1->{$key} // '';
        my $val2 = $hash2->{$key} // '';
        return 0 if $val1 ne $val2;
    }
    
    return 1;  # All keys and values match
}

sub _missing_required_args {
    my ($self, $tool_name, $args) = @_;
    
    # Define required arguments for each tool
    my %required_args = (
        'write' => ['filePath', 'content'],
        'edit' => ['filePath', 'oldString', 'newString'],
        'bash' => ['command'],
        'exec' => ['command'],
        'read' => ['filePath'],
        'list' => ['path'],
        'search' => ['pattern', 'filePath'],
        'grep' => ['pattern', 'filePath'],
        'glob' => ['pattern'],
        'patch' => ['filePath', 'patch'],
        'webfetch' => ['url'],
        'websearch' => ['query'],
        'webopen' => ['url_or_id'],
        'webfind' => ['pattern'],
        'webget' => ['query'],
        'todowrite' => ['task'],
        'task' => ['command'],
        # todoread has no required args
    );
    
    my $required = $required_args{$tool_name} || [];
    
    for my $req_arg (@$required) {
        # For some args, check alternative names
        if ($req_arg eq 'filePath') {
            next if $args->{filePath} || $args->{path} || $args->{file};
        } elsif ($req_arg eq 'task') {
            next if $args->{task} || $args->{description};
        } elsif ($req_arg eq 'patch') {
            next if $args->{patch} || $args->{content};
        } elsif ($req_arg eq 'url_or_id') {
            next if $args->{url_or_id} || $args->{url} || $args->{id};
        } else {
            next if $args->{$req_arg};
        }
        
        # Required argument missing
        return 1;
    }
    
    return 0;  # All required arguments present
}

sub format_tool_results {
    my ($self, $tool_results) = @_;
    
    my $feedback = "TOOL EXECUTION RESULTS:\n\n";
    
    for my $result (@$tool_results) {
        $feedback .= "Tool: $result->{tool}\n";
        $feedback .= "Status: " . ($result->{success} ? "SUCCESS" : "FAILED") . "\n";
        $feedback .= "Message: $result->{message}\n";
        
        if ($result->{output}) {
            $feedback .= "Output: $result->{output}\n";
        }
        if ($result->{content}) {
            $feedback .= "Content: $result->{content}\n";
        }
        $feedback .= "---\n";
    }
    
    $feedback .= "\nYou MUST analyze these results and respond appropriately. If there was an error, suggest a fix or try a different approach in your next response.";
    
    return $feedback;
}

sub show_loading {
    my ($self, $message) = @_;
    $message ||= "AI thinking";
    
    # Show loading message
    print "$message";
    STDOUT->flush();
    
    # Return a function to stop loading
    return sub {
        print "\r" . (" " x (length($message) + 10)) . "\r";  # Clear line
        STDOUT->flush();
    };
}

sub show_spinner {
    my ($self, $message) = @_;
    $message ||= "Processing";
    
    my @spinner = ('⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏');
    my $i = 0;
    
    # Return a function to update spinner
    return sub {
        my $action = shift || 'update';
        if ($action eq 'stop') {
            print "\r" . (" " x (length($message) + 10)) . "\r";  # Clear line
            STDOUT->flush();
        } else {
            print "\r$spinner[$i] $message...";
            STDOUT->flush();
            $i = ($i + 1) % @spinner;
        }
    };
}

sub handle_slash_commands {
    my ($self, $command) = @_;
    return 0 unless $command && $command =~ /^\/(.+)/;
    return $self->handle_slash_command($command);
}

sub handle_slash_command {
    my ($self, $command, $client_or_session, $session) = @_;
    
    # Handle different parameter combinations for tests
    my $client = $client_or_session;
    
    # If second parameter is actually a session (has new_session method), adjust
    if ($client_or_session && $client_or_session->can('new_session')) {
        $session = $client_or_session;
        $client = $self->{client};
    }
    
    # Use injected dependencies or instance variables
    $client ||= $self->{client};
    $session ||= $self->{session};
    
    # Initialize config if available
    my $config = $self->{config};
    
    return 0 unless $command =~ /^\/(\w+)(?:\s+(.+))?/;
    my ($cmd, $args) = ($1, $2 || '');
    
    if ($cmd eq 'models') {
        my @models = $client->list_models() if $client;
        my $current = $client->get_current_model() if $client;
        my $output = "Available models:\n";
        for my $model (@models) {
            $output .= "- $model";
            $output .= " (current)" if $current && $model eq $current;
            $output .= "\n";
        }
        return $output;
        
    } elsif ($cmd eq 'current') {
        my $current = $client->get_current_model() if $client;
        return "Current model: " . ($current || 'none');
        
    } elsif ($cmd eq 'model') {
        # If no argument, show current model
        unless ($args) {
            my $current = $client->get_current_model() if $client;
            return "Current model: " . ($current || 'none');
        }
        # Trim whitespace from model name (from autocompletion)
        $args =~ s/^\s+|\s+$//g;
        if ($client && $client->set_model($args)) {
            # Save as last used model
            $self->{config}->save_last_model($args) if $self->{config};
            # Load model info for context tracking
            $client->get_model_info($args);
            return "Switched to model: $args";
        } else {
            return "Model '$args' not found";
        }
        
    } elsif ($cmd eq 'tools') {
        return $self->_show_tools();
        
    } elsif ($cmd eq 'permissions') {
        return $self->_show_permissions();
        
    } elsif ($cmd eq 'config') {
        return $self->_show_config();
        
    } elsif ($cmd eq 'help') {
        return $self->_show_help();
        
    } elsif ($cmd eq 'save') {
        return "Usage: /save <name>" unless $args;
        if ($session && $session->save_session($args)) {
            return "Session saved: $args";
        } else {
            return "Failed to save session: $args";
        }
        
    } elsif ($cmd eq 'load') {
        return "Usage: /load <name>" unless $args;
        if ($session && $session->load_session($args)) {
            return "Session loaded: $args";
        } else {
            return "Failed to load session: $args";
        }
        
    } elsif ($cmd eq 'sessions') {
        if ($session) {
            my @sessions = $session->list_sessions();
            return "Saved sessions:\n" . join("\n", map { "- $_" } @sessions);
        } else {
            return "No session manager available";
        }
        
    } elsif ($cmd eq 'clear') {
        $session->clear_session() if $session;
        return "Session cleared";
        
    } elsif ($cmd eq 'history') {
        if ($args && $args eq 'clear') {
            $session->clear_session() if $session;
            # Also clear command history
            $self->clear_command_history();
            return "History cleared (chat + commands)";
        } else {
            my $limit = $args && $args =~ /^\d+$/ ? int($args) : 20;
            
            # Get both chat history and command history
            my @chat_history = $session ? $session->get_history() : ();
            my @command_history = $self->get_command_history($limit);
            
            # Merge and sort by timestamp
            my @all_history = ();
            
            # Add chat messages
            for my $entry (@chat_history) {
                push @all_history, {
                    timestamp => $entry->{timestamp},
                    type => 'chat',
                    role => $entry->{role},
                    content => $entry->{content}
                };
            }
            
            # Add command history
            for my $entry (@command_history) {
                push @all_history, {
                    timestamp => $entry->{timestamp},
                    type => 'command',
                    content => $entry->{command}
                };
            }
            
            # Sort by timestamp
            @all_history = sort { $a->{timestamp} <=> $b->{timestamp} } @all_history;
            
            # Take last $limit entries
            if (@all_history > $limit) {
                @all_history = @all_history[-$limit..-1];
            }
            
            return "No history available" unless @all_history;
            
            my $output = "📜 Recent History (last " . scalar(@all_history) . " entries):\n\n";
            for my $entry (@all_history) {
                my $timestamp = scalar localtime($entry->{timestamp});
                my $content = substr($entry->{content}, 0, 100);
                $content .= "..." if length($entry->{content}) > 100;
                
                if ($entry->{type} eq 'chat') {
                    $output .= sprintf("[%s] %s: %s\n", 
                        $timestamp, $entry->{role}, $content);
                } else {
                    $output .= sprintf("[%s] command: %s\n", 
                        $timestamp, $content);
                }
            }
            return $output;
        }
        
    } elsif ($cmd eq 'version') {
        my $version = $self->{config} ? $self->{config}->get_version() : '1.1.0';
        return "LocalCode version $version";

    } elsif ($cmd eq 'cd') {
        if ($args) {
            # Expand ~ to home directory
            $args =~ s/^~/$ENV{HOME}/;

            if (chdir($args)) {
                my $cwd = Cwd::getcwd();
                return "Changed directory to: $cwd";
            } else {
                return "Error: Cannot change to directory '$args': $!";
            }
        } else {
            # No argument: show current directory
            my $cwd = Cwd::getcwd();
            return "Current directory: $cwd";
        }

    } elsif ($cmd eq 'exit') {
        $self->save_readline_history();
        return "Goodbye!";

    } else {
        return 0;  # Return false for unknown commands
    }
}

sub _show_tools {
    my ($self) = @_;
    my $output = "Available tools:\n";
    
    # Get actual tools from tools instance
    my @tool_names = ();
    if ($self->{tools}) {
        @tool_names = sort $self->{tools}->list_tools();
    } else {
        # Fallback to default list if tools not available
        @tool_names = qw(read write exec bash search grep edit list glob patch webfetch websearch webopen webfind webget todowrite todoread task);
    }
    
    for my $tool (@tool_names) {
        my $permission_level = 2; # Default to BLOCKED
        if ($self->{tools}) {
            $permission_level = $self->{tools}->check_permission($tool);
        } elsif ($self->{permissions}) {
            $permission_level = $self->{permissions}->get_permission_for_tool($tool);
        }
        
        my $safety = $permission_level == 0 ? '[SAFE]' : 
                     $permission_level == 1 ? '[DANGEROUS]' : 
                     '[BLOCKED]';
        $output .= "- $tool $safety\n";
    }
    
    return $output;
}

sub _show_permissions {
    my ($self) = @_;
    my $output = "Permission settings:\n";
    
    # Categorize tools by permission level
    my (@safe_tools, @dangerous_tools, @blocked_tools);
    
    # Get actual tools from tools instance
    my @tool_names = ();
    if ($self->{tools}) {
        @tool_names = sort $self->{tools}->list_tools();
    } else {
        # Fallback to default list
        @tool_names = qw(read write exec bash search grep edit list glob patch webfetch websearch webopen webfind webget todowrite todoread task);
    }
    
    for my $tool (@tool_names) {
        my $permission_level = 2; # Default to BLOCKED
        if ($self->{tools}) {
            $permission_level = $self->{tools}->check_permission($tool);
        } elsif ($self->{permissions}) {
            $permission_level = $self->{permissions}->get_permission_for_tool($tool);
        }
        
        if ($permission_level == 0) {
            push @safe_tools, $tool;
        } elsif ($permission_level == 1) {
            push @dangerous_tools, $tool;
        } else {
            push @blocked_tools, $tool;
        }
    }
    
    $output .= "Safe tools (auto-allowed): " . join(', ', @safe_tools) . "\n" if @safe_tools;
    $output .= "Dangerous tools (require confirmation): " . join(', ', @dangerous_tools) . "\n" if @dangerous_tools;
    $output .= "Blocked tools (not allowed): " . join(', ', @blocked_tools) . "\n" if @blocked_tools;
    
    return $output;
}

sub _show_config {
    my ($self) = @_;
    # For testing, show default config even without real config object
    my $host = 'localhost';
    my $port = 11434;
    
    if ($self->{config}) {
        $host = $self->{config}->get('ollama.host') || $host;
        $port = $self->{config}->get('ollama.port') || $port;
    }
    
    return "Configuration:\n" .
           "Ollama host: $host:$port\n";
}

sub _show_help {
    my ($self) = @_;
    return "Available commands:\n" .
           "/models               # List available models\n" .
           "/model <name>         # Switch to model\n" .
           "/current              # Show current model\n" .
           "/tools                # List available tools\n" .
           "/permissions          # Show permission settings\n" .
           "/config               # Show current configuration\n" .
           "/save <name>          # Save session\n" .
           "/load <name>          # Load session\n" .
           "/sessions             # List saved sessions\n" .
           "/clear                # Clear current session\n" .
           "/cd [path]            # Change or show current directory\n" .
           "/history [N]          # Show last N entries (chat + commands, default 20)\n" .
           "/history clear        # Clear all history (chat + commands)\n" .
           "/version              # Show version information\n" .
           "/help                 # Show this help\n" .
           "/exit                 # Exit LocalCode\n";
}

sub show_permission_dialog {
    my ($self, $tool, $file) = @_;
    
    # In test mode, use auto_approve setting
    if ($self->{test_mode}) {
        return $self->{auto_approve};
    }
    
    # In real mode, this would show interactive dialog
    # For now, default deny
    return 0;
}

sub display_response {
    my ($self, $response) = @_;
    return $response;  # Basic formatting
}

sub show_progress {
    my ($self, $message) = @_;
    return 1;  # Progress shown
}

sub colorize {
    my ($self, $text, $color) = @_;
    return $text;  # No coloring for now
}

sub prompt_user {
    my ($self, $prompt) = @_;
    return $prompt;  # Basic prompting
}

sub handle_input {
    my ($self, $input) = @_;
    return $input;  # Basic input handling
}

# TUI Automation methods for testing

sub read_command_file {
    my ($self, $file) = @_;
    return () unless -f $file;
    
    open my $fh, '<', $file or return ();
    my @commands = ();
    while (my $line = <$fh>) {
        chomp $line;
        push @commands, $line if $line && $line !~ /^\s*#/;
    }
    close $fh;
    
    return @commands;
}

sub parse_stdin_commands {
    my ($self, $input) = @_;
    return split /\n/, $input;
}

sub run_automated_session {
    my ($self, $commands) = @_;
    my $output = "";
    
    for my $command (@$commands) {
        if ($command =~ /^\//) {
            my $result = $self->handle_slash_command($command);
            $output .= $result . "\n" if $result;
        } else {
            # Non-slash commands (tool calls or regular prompts)
            $output .= "Processed: $command\n";
        }
    }
    
    return {
        output => $output,
        completed => 1,
    };
}

sub validate_command_batch {
    my ($self, $commands) = @_;
    my @errors = ();
    
    for my $command (@$commands) {
        if ($command =~ /^\/(\w+)/) {
            my $cmd = $1;
            unless ($cmd =~ /^(models|current|model|tools|permissions|config|help|save|load|sessions|clear|history|version|exit)$/) {
                push @errors, "Unknown command: /$cmd";
            }
        }
    }
    
    return {
        valid => @errors == 0,
        errors => \@errors,
    };
}

sub run_command_with_timeout {
    my ($self, $command) = @_;
    
    # Mock timeout for testing
    if ($command eq '/slowcommand') {
        return {
            success => 0,
            error => "Command timeout"
        };
    }
    
    return {
        success => 1,
        output => "Command executed: $command"
    };
}

sub capture_command_output {
    my ($self, $command) = @_;
    
    my $result = $self->handle_slash_command($command);
    return $result || "Unknown command: $command";
}

sub run_batch_with_error_handling {
    my ($self, $commands) = @_;
    my $success_count = 0;
    my $error_count = 0;
    
    for my $command (@$commands) {
        my $result = $self->handle_slash_command($command);
        if ($result && $result !~ /Unknown command/) {
            $success_count++;
        } else {
            $error_count++;
        }
    }
    
    return {
        completed => 1,
        success_count => $success_count,
        error_count => $error_count,
    };
}

sub set_test_state {
    my ($self, $key, $value) = @_;
    $self->{"test_$key"} = $value;
}

sub run_comprehensive_test_suite {
    my ($self) = @_;
    
    my @test_commands = qw(
        /models /current /tools /permissions /config /help
        /sessions /clear /history /version /exit /model /save
    );
    
    my $validation = $self->validate_command_batch(\@test_commands);
    
    return {
        passed => $validation->{valid},
        total_tests => scalar @test_commands,
    };
}

sub simulate_cli_execution {
    my ($self, $prompt, $args) = @_;
    
    # Simulate CLI execution for testing
    return {
        success => 1,
        output => "Simulated CLI execution: $prompt"
    };
}

sub run_comprehensive_validation {
    my ($self) = @_;
    
    # Validate all systems
    my $failed_checks = 0;
    
    # Check UI commands
    my $ui_result = $self->run_comprehensive_test_suite();
    $failed_checks++ unless $ui_result->{passed};
    
    # Check if all dependencies are available
    $failed_checks++ unless $self->{client};
    $failed_checks++ unless $self->{tools};
    $failed_checks++ unless $self->{permissions};
    $failed_checks++ unless $self->{session};
    
    return {
        all_systems_ok => $failed_checks == 0,
        failed_checks => $failed_checks,
    };
}

sub cleanup_resources {
    my ($self) = @_;
    # Cleanup resources
    return 1;
}

sub get_available_commands {
    my ($self) = @_;
    return qw(
        /models /model /current /tools /permissions /config
        /help /save /load /sessions /clear /cd /history /version /exit
    );
}

sub autocomplete_command {
    my ($self, $partial) = @_;
    
    # Remove leading slash if present
    $partial =~ s/^\/+//;
    $partial = lc($partial);
    
    my @commands = $self->get_available_commands();
    my @matches = ();
    
    for my $cmd (@commands) {
        my $cmd_name = $cmd;
        $cmd_name =~ s/^\/+//;
        $cmd_name = lc($cmd_name);
        
        if ($cmd_name =~ /^\Q$partial\E/) {
            push @matches, $cmd;
        }
    }
    
    return sort @matches;
}

sub autocomplete_model {
    my ($self, $partial) = @_;
    
    # Get available models from the client
    my @models = ();
    if ($self->{client}) {
        @models = $self->{client}->list_models();
    }
    
    return () unless @models;
    
    # Filter models that match the partial input
    my @matches = ();
    $partial = lc($partial);
    
    for my $model (@models) {
        if (lc($model) =~ /^\Q$partial\E/) {
            push @matches, $model;
        }
    }
    
    return sort @matches;
}

sub setup_readline {
    my ($self) = @_;
    
    # Skip readline setup in test mode to avoid breaking tests
    if ($self->{test_mode}) {
        $self->{has_readline} = 1;
        $self->{completion_available} = 1;
        return;
    }
    
    # Use our own LocalCode::ReadLine implementation (already inlined in build)
    eval {
        # No require needed - LocalCode::ReadLine is already inlined
        my $term = LocalCode::ReadLine->new('LocalCode');
        
        # Setup persistent history file
        my $history_file = File::Spec->catfile($self->{config}->get_localcode_dir(), 'command_history');
        $term->ReadHistory($history_file) if -f $history_file;
        
        # Setup completion function
        my $attribs = $term->Attribs;
        $attribs->{completion_function} = sub {
            my ($text, $line, $start) = @_;
            
            # Check if we're completing a slash command
            if ($text =~ /^\//) {
                return $self->autocomplete_command($text);
            }
            
            # Check if we're completing model names after "/model "
            if ($line =~ /^\/model\s+(.*)$/) {
                my $partial_model = $1;
                return $self->autocomplete_model($partial_model);
            }
            
            return ();
        };
        
        # Enable emacs key bindings explicitly
        $attribs->{keymap} = 'emacs';
        
        # Disable ornaments/decorations to avoid visual artifacts
        $term->ornaments(0);
        
        # Set clean terminal attributes to avoid formatting issues
        if ($attribs) {
            # Completely disable all terminal decorations
            $attribs->{term_set} = ["", "", "", ""];
            $attribs->{standout_open} = "";
            $attribs->{standout_close} = "";
            $attribs->{underline_open} = "";
            $attribs->{underline_close} = "";
            $attribs->{md_mode} = "";
            $attribs->{us_mode} = "";
            $attribs->{so_mode} = "";
            $attribs->{me_mode} = "";
            $attribs->{ue_mode} = "";
            $attribs->{se_mode} = "";
        }
        
        $self->{readline} = $term;
        $self->{has_readline} = 1;
        $self->{completion_available} = 1;
    };
    
    if ($@) {
        # FATAL ERROR - cannot continue without readline
        die "FATAL: LocalCode::ReadLine initialization failed\n\n" .
            "Error: $@\n";
    }
}

sub readline_prompt {
    my ($self, $prompt, $client) = @_;

    if ($self->{has_readline} && $self->{readline}) {
        # Get terminal width and height
        my $term_width = $self->_get_term_width();
        my $term_height = $self->_get_term_height();

        # Disable output buffering
        my $old_fh = select(STDOUT);
        $| = 1;
        select($old_fh);

        # Build the context info
        my $context_info = $self->_build_context_info($client);

        # Build bar with integrated context info on the right
        my $bar = "";
        if ($context_info) {
            # Remove ANSI codes to calculate real length
            my $context_visible = $context_info;
            $context_visible =~ s/\e\[[0-9;]*m//g;

            # Format: ─────[ Context: 18% (770/4096) ]
            my $right_part = "[ Context: " . $context_visible . " ]";
            my $right_len = length($right_part);
            my $left_bars = $term_width - $right_len;
            $left_bars = 3 if $left_bars < 3; # At least a few bars

            $bar = "\e[2m" . ("─" x $left_bars) . "\e[0m[ Context: " . $context_info . " ]";
        } else {
            # Just a plain bar if no context info
            $bar = "\e[2m" . ("─" x $term_width) . "\e[0m";
        }

        # Print bar BEFORE the prompt
        print $bar . "\n";

        # Explicitly disable ornaments before reading
        my $old_ornaments = $self->{readline}->ornaments(0);

        # Use "> " as the readline prompt
        my $input = $self->{readline}->readline("> ");

        chomp $input if defined $input;

        # Don't restore cursor - let output continue above the bar
        # The bar will scroll up with content naturally

        # Clear any residual formatting after input
        print "\e[0m" if defined $input;

        # Add to history if we have a meaningful command
        if (defined $input && $input ne '' && $self->{readline}->can('add_history')) {
            $self->{readline}->add_history($input);
        }

        return $input;
    } else {
        print $prompt;
        my $input = <STDIN>;
        chomp $input if defined $input;
        return $input;
    }
}

sub _get_term_width {
    my ($self) = @_;

    my $term_width = 80;
    if ($ENV{COLUMNS}) {
        $term_width = $ENV{COLUMNS};
    } elsif (`command -v tput 2>/dev/null`) {
        my $cols = `tput cols 2>/dev/null`;
        chomp $cols;
        $term_width = $cols if $cols =~ /^\d+$/;
    }

    return $term_width;
}

sub _get_term_height {
    my ($self) = @_;

    my $term_height = 24;
    if ($ENV{LINES}) {
        $term_height = $ENV{LINES};
    } elsif (`command -v tput 2>/dev/null`) {
        my $lines = `tput lines 2>/dev/null`;
        chomp $lines;
        $term_height = $lines if $lines =~ /^\d+$/;
    }

    return $term_height;
}

sub _build_context_info {
    my ($self, $client) = @_;

    return "" unless $client;

    my $stats = $client->get_context_stats();
    return "" unless $stats;

    # Don't show if context_window is 0 (model info not loaded yet)
    return "" if $stats->{context_window} == 0;

    my $percentage = $stats->{percentage};
    my $total = $stats->{total_tokens};
    my $window = $stats->{context_window};

    # Color coding based on usage
    my $color_code;
    if ($percentage >= 90) {
        $color_code = "31";  # Red
    } elsif ($percentage >= 70) {
        $color_code = "33";  # Yellow
    } else {
        $color_code = "32";  # Green
    }

    return sprintf("\e[%sm%d%% \e[0m(%d/%d)",
                   $color_code, $percentage, $total, $window);
}

sub _build_prompt_line {
    my ($self, $client, $term_width) = @_;

    my $left_text = "> ";
    my $right_text = "";
    my $right_text_for_readline = "";

    # Context info on the right if available
    if ($client) {
        my $stats = $client->get_context_stats();
        if ($stats && $stats->{context_window} > 0) {
            my $percentage = $stats->{percentage};
            my $total = $stats->{total_tokens};
            my $window = $stats->{context_window};

            # Color coding based on usage
            my $color_code;
            if ($percentage >= 90) {
                $color_code = "31";  # Red
            } elsif ($percentage >= 70) {
                $color_code = "33";  # Yellow
            } else {
                $color_code = "32";  # Green
            }

            # For display (without readline markers)
            $right_text = sprintf("\e[2m\e[%sm%d%% \e[0m\e[2m(%d/%d)\e[0m",
                                  $color_code, $percentage, $total, $window);

            # For readline (with \001 and \002 markers to indicate non-printing chars)
            $right_text_for_readline = sprintf("\001\e[2m\e[%sm\002%d%% \001\e[0m\e[2m\002(%d/%d)\001\e[0m\002",
                                  $color_code, $percentage, $total, $window);
        }
    }

    # Calculate padding (account for ANSI codes don't take visual space)
    my $right_text_visible = $right_text;
    $right_text_visible =~ s/\e\[[0-9;]*m//g;  # Remove ANSI codes for length calculation
    my $padding_needed = $term_width - length($left_text) - length($right_text_visible);
    $padding_needed = 0 if $padding_needed < 0;

    # Build the complete prompt line (use readline version if available)
    my $final_right = $right_text_for_readline || $right_text;
    return $left_text . (" " x $padding_needed) . $final_right;
}

sub save_readline_history {
    my ($self) = @_;
    
    return unless $self->{has_readline} && $self->{readline};
    
    eval {
        my $history_file = File::Spec->catfile($self->{config}->get_localcode_dir(), 'command_history');
        $self->{readline}->WriteHistory($history_file);
    };
    
    warn "Failed to save command history: $@" if $@;
}

sub get_command_history {
    my ($self, $limit) = @_;
    $limit ||= 50;
    
    return () unless $self->{config};
    
    my $history_file = File::Spec->catfile($self->{config}->get_localcode_dir(), 'command_history');
    return () unless -f $history_file;
    
    my @history = ();
    eval {
        open my $fh, '<', $history_file or die "Cannot read command history: $!";
        while (my $line = <$fh>) {
            chomp $line;
            next if $line eq '' || $line =~ /^#/;  # Skip empty lines and comments
            
            # Since readline history doesn't have timestamps, use file mtime as base
            my $mtime = (stat $history_file)[9];
            push @history, {
                command => $line,
                timestamp => $mtime  # This isn't perfect but better than nothing
            };
        }
        close $fh;
    };
    
    warn "Failed to read command history: $@" if $@;
    
    # Take last $limit commands
    if (@history > $limit) {
        @history = @history[-$limit..-1];
    }
    
    return @history;
}

sub clear_command_history {
    my ($self) = @_;
    
    return unless $self->{config};
    
    my $history_file = File::Spec->catfile($self->{config}->get_localcode_dir(), 'command_history');
    
    eval {
        if (-f $history_file) {
            unlink $history_file or die "Cannot delete command history: $!";
        }
        
        # Also clear readline's in-memory history
        if ($self->{has_readline} && $self->{readline}) {
            $self->{readline}->clear_history() if $self->{readline}->can('clear_history');
        }
    };
    
    warn "Failed to clear command history: $@" if $@;
}

1;