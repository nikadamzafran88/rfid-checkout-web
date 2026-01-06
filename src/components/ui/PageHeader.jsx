import React from 'react';
import { Box, Typography } from '@mui/material';

export default function PageHeader({ title, subtitle, actions = null }) {
  return (
    <Box sx={{ display: 'flex', alignItems: { xs: 'flex-start', md: 'center' }, justifyContent: 'space-between', gap: 2, mb: 3 }}>
      <Box>
        <Typography variant="h4" sx={{ fontWeight: 650, lineHeight: 1.15 }}>
          {title}
        </Typography>
        {subtitle ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
            {subtitle}
          </Typography>
        ) : null}
      </Box>

      {actions ? <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'flex-end' }}>{actions}</Box> : null}
    </Box>
  );
}
