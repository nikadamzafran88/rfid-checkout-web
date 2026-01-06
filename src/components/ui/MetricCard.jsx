import React from 'react';
import { Card, CardContent, Box, Typography, useTheme } from '@mui/material';

const MetricCard = ({ title, value, color = '#4f46e5', icon: Icon = null, spark = null }) => {
  const theme = useTheme();

  return (
    <Card elevation={0} sx={{ border: `1px solid ${theme.palette.divider}`, borderRadius: 2 }}>
      <CardContent>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
          <Box sx={{ height: 40, width: 40, borderRadius: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: color, color: '#fff' }}>
            {Icon ? <Icon size={18} color="white" /> : null}
          </Box>

          <Box sx={{ flex: 1 }}>
            <Typography variant="caption" sx={{ textTransform: 'uppercase', color: 'text.secondary', display: 'block' }}>{title}</Typography>
            <Box sx={{ mt: 0.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Typography variant="h5" sx={{ fontWeight: 800 }}>{value}</Typography>
            </Box>

            <Box sx={{ height: 0.5, mt: 1.5, backgroundColor: theme.palette.grey[200], borderRadius: 99, overflow: 'hidden' }}>
              <Box component="span" sx={{ display: 'block', height: '100%', width: '60%', bgcolor: color }} />
            </Box>
          </Box>

          {spark && (
            <Box sx={{ display: { xs: 'none', sm: 'block' }, width: 96, height: 40, ml: 1 }}>{spark}</Box>
          )}
        </Box>
      </CardContent>
    </Card>
  );
};

export default MetricCard;
