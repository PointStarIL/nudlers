import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  isChunkError: boolean;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, isChunkError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    const isChunkError = error.name === 'ChunkLoadError' ||
      error.message?.includes('Loading chunk') ||
      error.message?.includes('Failed to load chunk') ||
      error.message?.includes('Loading CSS chunk');
    return { hasError: true, error, isChunkError };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    const isChunkError = error.name === 'ChunkLoadError' ||
      error.message?.includes('Loading chunk') ||
      error.message?.includes('Failed to load chunk') ||
      error.message?.includes('Loading CSS chunk');

    if (isChunkError) {
      // Chunk load errors usually mean a new deployment happened.
      // Auto-reload once to get the fresh chunks.
      const reloadKey = 'chunk-error-reload';
      const lastReload = sessionStorage.getItem(reloadKey);
      if (!lastReload || Date.now() - Number(lastReload) > 30000) {
        sessionStorage.setItem(reloadKey, String(Date.now()));
        window.location.reload();
        return;
      }
    }

    console.error('[ErrorBoundary]', error, errorInfo.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, isChunkError: false });
  };

  render() {
    if (this.state.hasError) {
      return (
        <Box sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '50vh',
          gap: 2,
          p: 4,
          textAlign: 'center'
        }}>
          <Typography variant="h5" color="error">
            {this.state.isChunkError ? 'Update Available' : 'Something went wrong'}
          </Typography>
          <Typography variant="body1" color="text.secondary">
            {this.state.isChunkError
              ? 'A newer version is available. Please reload the page.'
              : 'An unexpected error occurred. Please try again.'}
          </Typography>
          <Button
            variant="contained"
            onClick={this.state.isChunkError ? () => window.location.reload() : this.handleReset}
            sx={{ mt: 2 }}
          >
            {this.state.isChunkError ? 'Reload Page' : 'Try Again'}
          </Button>
        </Box>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
