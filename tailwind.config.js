/** @type {import('tailwindcss').Config} */
export default {
  // This array tells Tailwind to scan all files in src for class usage
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}