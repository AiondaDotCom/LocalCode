#!/usr/bin/env perl
use strict;
use warnings;
use Test::More tests => 68;
use lib 'lib';

BEGIN { use_ok('LocalCode::UI') }

my $ui = LocalCode::UI->new();
ok($ui, 'UI object created');

# Test system prompt injection
my $prompt = $ui->inject_system_prompt('user prompt');
like($prompt, qr/You are a bot/, 'System prompt injected');
like($prompt, qr/tool_call name="read"/, 'Tools listed in prompt');
like($prompt, qr/bash, read, write/, 'Tool commands indicated');
# Note: inject_system_prompt now only returns system prompt, not user prompt
is($prompt, $ui->get_system_prompt(), 'System prompt consistent');

# Test tool call parsing
my $response = 'I will <tool_call name="read" args={"filePath": "/tmp/test.txt"}> and then <tool_call name="write" args={"filePath": "/tmp/output.txt", "content": "content"}>';
my @tools = $ui->parse_tool_calls($response);
is(scalar @tools, 2, 'Two tool calls parsed');
is($tools[0]->{name}, 'read', 'First tool name correct');
is($tools[0]->{args}[0], '/tmp/test.txt', 'First tool arg correct');
is($tools[1]->{name}, 'write', 'Second tool name correct');

# Test slash command handling
ok($ui->handle_slash_commands('/models'), '/models command handled');
ok($ui->handle_slash_commands('/current'), '/current command handled');
ok($ui->handle_slash_commands('/help'), '/help command handled');
ok($ui->handle_slash_commands('/exit'), '/exit command handled');
ok(!$ui->handle_slash_commands('/invalid'), 'Invalid command rejected');

# Test permission dialog
$ui->{test_mode} = 1;
$ui->{auto_approve} = 1;
my $result = $ui->show_permission_dialog('write', '/tmp/test.txt');
ok($result, 'Permission granted in test mode');

$ui->{auto_approve} = 0;
$result = $ui->show_permission_dialog('write', '/tmp/test.txt');
ok(!$result, 'Permission denied in test mode');

# Test display formatting
my $formatted = $ui->display_response('test response');
like($formatted, qr/test response/, 'Response formatted');

# Test progress indicators
ok($ui->show_progress('Testing...'), 'Progress indicator shown');

# Test color support
$ui->{colors} = 1;
my $colored = $ui->colorize('test', 'green');
like($colored, qr/test/, 'Text colorized');

# Test XML parser with self-closing tags
my $self_closing_response = 'I will <tool_call name="webfetch" args={"url": "https://example.com"} />';
my @self_closing_tools = $ui->parse_tool_calls($self_closing_response);
is(scalar @self_closing_tools, 1, 'Self-closing tool call parsed');
is($self_closing_tools[0]->{name}, 'webfetch', 'Self-closing tool name correct');
is($self_closing_tools[0]->{args}[0], 'https://example.com', 'Self-closing tool arg correct');

# Test empty args with self-closing tags
my $empty_args_response = 'I will <tool_call name="todoread" args={} />';
my @empty_args_tools = $ui->parse_tool_calls($empty_args_response);
is(scalar @empty_args_tools, 1, 'Empty args tool call parsed');
is($empty_args_tools[0]->{name}, 'todoread', 'Empty args tool name correct');
is(scalar @{$empty_args_tools[0]->{args}}, 0, 'Empty args array correct');

# Test empty args without self-closing tags
my $empty_args_normal = 'I will <tool_call name="todoread" args={}>';
my @empty_args_normal_tools = $ui->parse_tool_calls($empty_args_normal);
is(scalar @empty_args_normal_tools, 1, 'Empty args normal tool call parsed');
is($empty_args_normal_tools[0]->{name}, 'todoread', 'Empty args normal tool name correct');

# Test mixed formats in one response
my $mixed_response = 'First <tool_call name="read" args={"filePath": "test.txt"}> then <tool_call name="todoread" args={} /> and finally <tool_call name="bash" args={"command": "ls"} />';
my @mixed_tools = $ui->parse_tool_calls($mixed_response);
is(scalar @mixed_tools, 3, 'Mixed format tool calls parsed');
is($mixed_tools[0]->{name}, 'read', 'Mixed: first tool correct');
is($mixed_tools[1]->{name}, 'todoread', 'Mixed: second tool correct');
is($mixed_tools[2]->{name}, 'bash', 'Mixed: third tool correct');

# Test new tools parsing
my $new_tools_response = '<tool_call name="glob" args={"pattern": "*.pl", "directory": "./lib"}> and <tool_call name="patch" args={"filePath": "test.txt", "patch": "patch content"}>';
my @new_tools = $ui->parse_tool_calls($new_tools_response);
is(scalar @new_tools, 2, 'New tools parsed');
is($new_tools[0]->{name}, 'glob', 'Glob tool name correct');
is($new_tools[0]->{args}[0], '*.pl', 'Glob pattern correct');
is($new_tools[0]->{args}[1], './lib', 'Glob directory correct');
is($new_tools[1]->{name}, 'patch', 'Patch tool name correct');

# Test case insensitive tool names
my $case_response = '<tool_call name="WEBFETCH" args={"url": "https://test.com"}> and <tool_call name="BaSh" args={"command": "pwd"}>';
my @case_tools = $ui->parse_tool_calls($case_response);
is(scalar @case_tools, 2, 'Case insensitive tools parsed');
is($case_tools[0]->{name}, 'webfetch', 'Case: webfetch normalized');
is($case_tools[1]->{name}, 'bash', 'Case: bash normalized');

# Test incomplete tool calls (missing closing >)
my $incomplete_response = '<tool_call name="write" args={"filePath": "./test.pl", "content": "#!/usr/bin/perl\\nprint \\"hello\\";"}> This will create a test file.';
my @incomplete_tools = $ui->parse_tool_calls($incomplete_response);
is(scalar @incomplete_tools, 1, 'Incomplete tool call parsed');
is($incomplete_tools[0]->{name}, 'write', 'Incomplete: tool name correct');
is($incomplete_tools[0]->{args}[0], './test.pl', 'Incomplete: file path correct');
like($incomplete_tools[0]->{args}[1], qr/perl/i, 'Incomplete: content parsed with perl code');

# Test tool calls inside code blocks
my $codeblock_response = 'Here is the command:\n\n```\n<tool_call name="bash" args={"command": "ls -la"}>\n```\n\nAnd another one:\n\n```\n<tool_call name="write" args={"filePath": "test.txt", "content": "hello world"}>\n```';
my @codeblock_tools = $ui->parse_tool_calls($codeblock_response);
is(scalar @codeblock_tools, 2, 'Code block tool calls parsed');
is($codeblock_tools[0]->{name}, 'bash', 'Code block: first tool correct');
is($codeblock_tools[1]->{name}, 'write', 'Code block: second tool correct');

# Test mixed quotes in tool calls
my $mixed_quotes_response = '<tool_call name="edit" args={\'filePath\': \'./test.pl\', \'oldString\': "old text", "newString": \'new text\'}>';
my @mixed_quotes_tools = $ui->parse_tool_calls($mixed_quotes_response);
is(scalar @mixed_quotes_tools, 1, 'Mixed quotes tool call parsed');
is($mixed_quotes_tools[0]->{name}, 'edit', 'Mixed quotes: tool name correct');
is($mixed_quotes_tools[0]->{args}[0], './test.pl', 'Mixed quotes: file path correct');

# Test content with embedded quotes (the real problem)
my $embedded_quotes_response = '<tool_call name="write" args={"filePath": "./test.pl", "content": "#!/usr/bin/perl\\nuse strict;\\nuse warnings;\\nprint \\"hello world\\";\\n"}>';
my @embedded_quotes_tools = $ui->parse_tool_calls($embedded_quotes_response);
is(scalar @embedded_quotes_tools, 1, 'Embedded quotes tool call parsed');
is($embedded_quotes_tools[0]->{name}, 'write', 'Embedded quotes: tool name correct');
is($embedded_quotes_tools[0]->{args}[0], './test.pl', 'Embedded quotes: file path correct');
like($embedded_quotes_tools[0]->{args}[1], qr/perl.*strict.*warnings.*print.*hello world/s, 'Embedded quotes: full content preserved');

# Test content with unescaped quotes (problematic case)
my $problematic_response = '<tool_call name="write" args={"filePath": "./calc.pl", "content": "#!/usr/bin/perl\\nuse strict;\\nuse warnings;\\nprint \\"Enter first number: \\";\\nmy $num1 = <STDIN>;\\nchomp $num1;\\nprint \\"Sum: \\", $num1 + 2;\\n"}>';
my @problematic_tools = $ui->parse_tool_calls($problematic_response);
is(scalar @problematic_tools, 1, 'Problematic quotes tool call parsed');
is($problematic_tools[0]->{name}, 'write', 'Problematic quotes: tool name correct');

# Test real-world use case: AI creates complex calculator with multiple tool calls
my $real_world_response = 'I\'ll create a calculator script for you.

<tool_call name="write" args={"filePath": "./calc.pl", "content": "#!/usr/bin/perl\\nuse strict;\\nuse warnings;\\nprint \\"Enter first number: \\";\\nmy $num1 = <STDIN>;\\nchomp($num1);\\nprint \\"Enter second number: \\";\\nmy $num2 = <STDIN>;\\nchomp($num2);\\nprint \\"Choose operation (+, -, *, /): \\";\\nmy $operation = <STDIN>;\\nchomp($operation);\\nmy $result;\\neval {\\n    if ($operation eq \\\'+\\\') { $result = $num1 + $num2; }\\n    elsif ($operation eq \\\'-\\\') { $result = $num1 - $num2; }\\n    elsif ($operation eq \\\'*\\\') { $result = $num1 * $num2; }\\n    elsif ($operation eq \\\'/\\\') {\\n        if ($num2 != 0) { $result = $num1 / $num2; }\\n        else { die \\"Division by zero\\"; }\\n    } else { die \\"Invalid operation\\\\n\\"; }\\n};\\nif ($@) {\\n    print \\"$@\\";\\n} else {\\n    print \\"Result: $result\\\\n\\";\\n}\\n"}>

Now let me make it executable:

<tool_call name="bash" args={"command": "chmod +x calc.pl", "description": "Make the script executable"}>

Let\'s test it:

<tool_call name="bash" args={"command": "./calc.pl", "description": "Run the calculator script"}>';

my @real_world_tools = $ui->parse_tool_calls($real_world_response);
is(scalar @real_world_tools, 3, 'Real world: three tool calls parsed');

# Find tools by name (order may vary due to parsing strategy)
my $write_tool = (grep { $_->{name} eq 'write' } @real_world_tools)[0];
my @bash_tools = grep { $_->{name} eq 'bash' } @real_world_tools;

ok($write_tool, 'Real world: write tool found');
is(scalar @bash_tools, 2, 'Real world: two bash tools found');

# Check the complex Perl content is preserved correctly
like($write_tool->{args}[1], qr/perl.*strict.*warnings.*Enter first number.*operation.*eval.*Division by zero/s, 'Real world: complex Perl content preserved');

# Check bash commands
my @bash_commands = map { $_->{args}[0] } @bash_tools;
ok((grep { $_ eq 'chmod +x calc.pl' } @bash_commands), 'Real world: chmod command found');
ok((grep { $_ eq './calc.pl' } @bash_commands), 'Real world: run command found');

# Test model autocompletion
use LocalCode::Client;
my $mock_client = LocalCode::Client->new();
$mock_client->{mock_mode} = 1;
$mock_client->{mock_models} = ['gpt-oss:20b', 'gpt-oss:120b', 'llama3:8b', 'mistral:7b'];
$ui->{client} = $mock_client;

my @gpt_matches = $ui->autocomplete_model('gpt');
is(scalar @gpt_matches, 2, 'Model autocomplete: gpt prefix matches 2 models');
ok((grep { $_ eq 'gpt-oss:20b' } @gpt_matches), 'Model autocomplete: gpt-oss:20b found');
ok((grep { $_ eq 'gpt-oss:120b' } @gpt_matches), 'Model autocomplete: gpt-oss:120b found');

my @llama_matches = $ui->autocomplete_model('llama');
is(scalar @llama_matches, 1, 'Model autocomplete: llama prefix matches 1 model');
is($llama_matches[0], 'llama3:8b', 'Model autocomplete: llama3:8b found');

my @empty_matches = $ui->autocomplete_model('nonexistent');
is(scalar @empty_matches, 0, 'Model autocomplete: no matches for nonexistent prefix');