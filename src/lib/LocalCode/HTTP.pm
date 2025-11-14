package LocalCode::HTTP;
use strict;
use warnings;
use Socket;
use IO::Socket::INET;

# Minimal HTTP client - no external dependencies
# Supports GET and POST requests to localhost (Ollama)

sub new {
    my ($class, %args) = @_;
    return bless {
        timeout => $args{timeout} || 120,
    }, $class;
}

sub get {
    my ($self, $url) = @_;
    return $self->_request('GET', $url);
}

sub post {
    my ($self, $url, %args) = @_;
    return $self->_request('POST', $url, %args);
}

sub _request {
    my ($self, $method, $url, %args) = @_;

    # Parse URL
    my ($proto, $host, $port, $path) = $url =~ m{^(https?)://([^:/ ]+):?(\d*)(.*)$};
    $port ||= ($proto eq 'https' ? 443 : 80);
    $path ||= '/';

    # Create socket
    my $socket = IO::Socket::INET->new(
        PeerAddr => $host,
        PeerPort => $port,
        Proto    => 'tcp',
        Timeout  => $self->{timeout},
    ) or return $self->_error("Connection failed: $!");

    # Build HTTP request
    my $request = "$method $path HTTP/1.1\r\n";
    $request .= "Host: $host:$port\r\n";
    $request .= "User-Agent: LocalCode/1.0\r\n";
    $request .= "Connection: close\r\n";

    if ($method eq 'POST' && $args{Content}) {
        my $content = $args{Content};
        my $content_type = $args{'Content-Type'} || 'application/json';
        $request .= "Content-Type: $content_type\r\n";
        $request .= "Content-Length: " . length($content) . "\r\n";
        $request .= "\r\n";
        $request .= $content;
    } else {
        $request .= "\r\n";
    }

    # Send request
    print $socket $request;

    # Read response
    my $response = '';
    while (my $line = <$socket>) {
        $response .= $line;
    }
    close $socket;

    return $self->_parse_response($response);
}

sub _parse_response {
    my ($self, $response) = @_;

    # Split headers and body
    my ($headers, $body) = split /\r?\n\r?\n/, $response, 2;

    # Parse status line
    my ($status_line, @header_lines) = split /\r?\n/, $headers;

    # Extract status code and message
    my $code = 500;
    my $message = 'Unknown Error';

    if ($status_line && $status_line =~ /^HTTP\/[\d.]+\s+(\d+)\s*(.*)$/) {
        $code = int($1);  # Force numeric
        $message = $2 || 'OK';
    }

    # Check for chunked transfer encoding
    if ($headers =~ /Transfer-Encoding:\s*chunked/i && $body) {
        $body = $self->_decode_chunked($body);
    }

    # Create response object
    return bless {
        code => $code,
        message => $message,
        content => $body || '',
        headers => $headers,
        success => ($code >= 200 && $code < 300),
    }, 'LocalCode::HTTP::Response';
}

sub _decode_chunked {
    my ($self, $chunked_body) = @_;

    my $decoded = '';
    my @lines = split /\r?\n/, $chunked_body;

    my $i = 0;
    while ($i < @lines) {
        my $chunk_size_line = $lines[$i++];

        # Parse chunk size (hex)
        my ($chunk_size) = $chunk_size_line =~ /^([0-9a-fA-F]+)/;
        last unless defined $chunk_size;

        my $size = hex($chunk_size);
        last if $size == 0;  # Last chunk

        # Read chunk data (may span multiple lines)
        my $chunk_data = '';
        while ($i < @lines && length($chunk_data) < $size) {
            $chunk_data .= $lines[$i++];
            $chunk_data .= "\n" if length($chunk_data) < $size && $i < @lines;
        }

        $decoded .= substr($chunk_data, 0, $size);
    }

    return $decoded;
}

sub _error {
    my ($self, $error) = @_;
    return bless {
        code => 500,
        message => $error,
        content => '',
        success => 0,
    }, 'LocalCode::HTTP::Response';
}

package LocalCode::HTTP::Response;
use strict;
use warnings;

sub is_success {
    my ($self) = @_;
    return $self->{success};
}

sub code {
    my ($self) = @_;
    return $self->{code};
}

sub message {
    my ($self) = @_;
    return $self->{message};
}

sub status_line {
    my ($self) = @_;
    return "$self->{code} $self->{message}";
}

sub content {
    my ($self) = @_;
    return $self->{content};
}

1;
