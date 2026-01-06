import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { createTheme, ThemeProvider, StyledEngineProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import palette from './palette';
import typography from './typography';
import listItemButtonOverride from './overrides/ListItemButton';

const ADMIN_STORAGE_KEY = 'admin-color-mode';

const ColorModeContext = createContext({
  mode: 'light',
  toggleColorMode: () => {},
  setMode: () => {},
});

export function useColorMode() {
  return useContext(ColorModeContext);
}

function buildTheme(mode) {
  const resolvedPalette = palette(mode);
  return createTheme({
    palette: resolvedPalette,
    typography,
    components: {
      MuiLink: {
        defaultProps: { underline: 'hover' },
        styleOverrides: {
          root: {
            fontWeight: 500,
          },
        },
      },
      ...(listItemButtonOverride({ palette: resolvedPalette }) || {}),
    },
  });
}

// Base app theme: always light so public/kiosk pages are unaffected.
export default function ThemeCustomization({ children }) {
  const theme = useMemo(() => buildTheme('light'), []);

  return (
    <StyledEngineProvider injectFirst>
      <ThemeProvider theme={theme}>
        <CssBaseline enableColorScheme />
        {children}
      </ThemeProvider>
    </StyledEngineProvider>
  );
}

// Admin-only theme wrapper: provides night mode toggle + persistence.
export function AdminThemeCustomization({ children }) {
  const [mode, setMode] = useState('light');

  useEffect(() => {
    try {
      const saved = localStorage.getItem(ADMIN_STORAGE_KEY);
      if (saved === 'light' || saved === 'dark') setMode(saved);
    } catch (e) {
      // ignore
    }
  }, []);

  const toggleColorMode = () => {
    setMode((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem(ADMIN_STORAGE_KEY, next);
      } catch (e) {
        // ignore
      }
      return next;
    });
  };

  const theme = useMemo(() => buildTheme(mode), [mode]);

  return (
    <ColorModeContext.Provider value={{ mode, toggleColorMode, setMode }}>
      <ThemeProvider theme={theme}>
        <CssBaseline enableColorScheme />
        {children}
      </ThemeProvider>
    </ColorModeContext.Provider>
  );
}
