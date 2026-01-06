// Typography configuration for MUI theme. Use Public Sans (Mantis default)
// Note: install `@fontsource/public-sans` if you want local font files instead of a remote import.
const typography = {
  fontFamily: ['"Public Sans"', 'Inter', 'Arial', 'sans-serif'].join(','),
  h1: {
    fontSize: '1.875rem',
    lineHeight: 1.15,
    marginTop: 0,
    marginBottom: 0,
    fontWeight: 700,
  },
  // sensible defaults for headings/body
  h2: { fontWeight: 600 },
  h3: { fontWeight: 600 },
  body1: { fontWeight: 400 },
  button: { textTransform: 'none', fontWeight: 600 },
};

export default typography;
