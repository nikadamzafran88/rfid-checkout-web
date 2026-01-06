import React from 'react';
import { Box, Paper, Typography } from '@mui/material';

export default function SectionCard({ title, subtitle, actions = null, children, sx = null }) {
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 }, borderRadius: 2, ...(sx || {}) }}>
      {(title || actions) ? (
        <Box sx={{ display: 'flex', alignItems: { xs: 'flex-start', md: 'center' }, justifyContent: 'space-between', gap: 2, mb: 2 }}>
          <Box>
            {title ? (
              <Typography variant="h6" sx={{ fontWeight: 650 }}>
                {title}
              </Typography>
            ) : null}
            {subtitle ? (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {subtitle}
              </Typography>
            ) : null}
          </Box>
          {actions ? <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'flex-end' }}>{actions}</Box> : null}
        </Box>
      ) : null}

      {children}
    </Paper>
  );
}
