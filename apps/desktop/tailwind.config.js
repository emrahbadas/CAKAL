/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        cakal: {
          gold: '#f59e0b',
          dark: '#09090b',
        },
      },
    },
  },
  plugins: [],
};
