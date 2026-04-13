/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        aegis: {
          50:  'rgb(var(--aegis-50)  / <alpha-value>)',
          100: 'rgb(var(--aegis-100) / <alpha-value>)',
          200: 'rgb(var(--aegis-200) / <alpha-value>)',
          300: 'rgb(var(--aegis-300) / <alpha-value>)',
          400: 'rgb(var(--aegis-400) / <alpha-value>)',
          500: 'rgb(var(--aegis-500) / <alpha-value>)',
          600: 'rgb(var(--aegis-600) / <alpha-value>)',
          700: 'rgb(var(--aegis-700) / <alpha-value>)',
          800: 'rgb(var(--aegis-800) / <alpha-value>)',
          900: 'rgb(var(--aegis-900) / <alpha-value>)',
          950: 'rgb(var(--aegis-950) / <alpha-value>)',
        },
        surface: {
          DEFAULT:      'rgb(var(--surface-primary)   / <alpha-value>)',
          secondary:    'rgb(var(--surface-secondary) / <alpha-value>)',
          muted:        'rgb(var(--surface-muted)     / <alpha-value>)',
          'ultra-dark': 'rgb(var(--surface-ultra-dark) / <alpha-value>)',
        },
      },
      fontFamily: {
        display: ['"DM Sans"', 'system-ui', 'sans-serif'],
        body: ['"DM Sans"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
    },
  },
  plugins: [],
}
