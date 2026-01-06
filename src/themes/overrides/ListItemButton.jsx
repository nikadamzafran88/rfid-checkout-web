export default function ListItemButton(theme) {
  return {
    MuiListItemButton: {
      styleOverrides: {
        root: {
          '&:hover': {
            backgroundColor: theme.palette.secondary?.light || 'rgba(6,182,212,0.08)'
          },
          '&.Mui-selected': {
            backgroundColor: theme.palette.primary?.light || 'rgba(79,70,229,0.08)',
            color: theme.palette.primary?.dark || '#4338ca',
            '&:hover, &:focus': {
              backgroundColor: theme.palette.primary?.light || 'rgba(79,70,229,0.08)'
            },
            '& .MuiListItemIcon-root': {
              color: theme.palette.primary?.dark || '#4338ca'
            }
          }
        }
      }
    }
  };
}
