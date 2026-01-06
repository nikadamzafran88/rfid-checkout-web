import React from 'react';
import { Box, Typography, Button } from '@mui/material';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    // Log to console for developer visibility
    // In production you might send this to an error tracking service
    console.error('Uncaught render error:', error, info);
    this.setState({ info });
  }

  render() {
    if (this.state.hasError) {
      return (
        <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 3 }}>
          <Box sx={{ maxWidth: 800 }}>
            <Typography variant="h5" gutterBottom>
              Something went wrong while rendering the app
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              We captured an error while loading a page. The details are shown below — please paste the message into the chat so I can investigate further.
            </Typography>
            <Box sx={{ bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', p: 2, borderRadius: 1, whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 13 }}>
              {String(this.state.error)}
              {this.state.info?.componentStack ? '\n\nComponent stack:\n' + this.state.info.componentStack : ''}
            </Box>
            <Box sx={{ mt: 2 }}>
              <Button variant="contained" onClick={() => window.location.reload()}>Reload</Button>
            </Box>
          </Box>
        </Box>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
