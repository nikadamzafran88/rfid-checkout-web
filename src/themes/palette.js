// Theme palette values translated from your index.css and Tailwind tokens.
// For dark mode, we intentionally rely on MUI's default dark palette values
// (no new hard-coded colors), while keeping the brand primary/secondary.

const lightPalette = {
  mode: 'light',
  primary: {
    main: '#4f46e5',
    contrastText: '#ffffff',
  },
  secondary: {
    main: '#ec4899',
  },
  background: {
    default: '#f0f2f5', // matches your index.css background-color
    paper: '#ffffff',
  },
  text: {
    primary: '#0f172a', // matches your index.css color
    secondary: '#6b7280',
  },
};

export default function getPalette(mode = 'light') {
  if (mode === 'dark') {
    return {
      mode: 'dark',
      primary: lightPalette.primary,
      secondary: lightPalette.secondary,
      background: {
        // Dark blue / navy (not pure black)
        default: '#0b1220',
        paper: '#0f1b2d',
      },
    };
  }

  return lightPalette;
}
