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
      },
      fontFamily: {
        display: ['"DM Sans"','system-ui','sans-serif'],
        body: ['"DM Sans"','system-ui','sans-serif'],
        mono: ['"JetBrains Mono"','monospace'],
      },
      animation: {
        'fade-in':'fadeIn 0.3s ease-out',
        'slide-up':'slideUp 0.3s ease-out',
        'slide-down':'slideDown 0.3s ease-out',
        'scale-in':'scaleIn 0.25s ease-out forwards',
        'slide-in-right':'slideInRight 0.35s ease-out forwards',
        'slide-in-bottom':'slideInBottom 0.35s ease-out forwards',
        'shimmer':'shimmer 2s infinite',
        'float':'float 3s ease-in-out infinite',
        'glow':'glowPulse 2s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: { '0%':{opacity:'0'},'100%':{opacity:'1'} },
        slideUp: { '0%':{opacity:'0',transform:'translateY(10px)'},'100%':{opacity:'1',transform:'translateY(0)'} },
        slideDown: { '0%':{opacity:'0',transform:'translateY(-10px)'},'100%':{opacity:'1',transform:'translateY(0)'} },
        scaleIn: { '0%':{opacity:'0',transform:'scale(0.92)'},'100%':{opacity:'1',transform:'scale(1)'} },
        slideInRight: { '0%':{opacity:'0',transform:'translateX(16px)'},'100%':{opacity:'1',transform:'translateX(0)'} },
        slideInBottom: { '0%':{opacity:'0',transform:'translateY(16px)'},'100%':{opacity:'1',transform:'translateY(0)'} },
        shimmer: { '0%':{backgroundPosition:'-200% 0'},'100%':{backgroundPosition:'200% 0'} },
        float: { '0%,100%':{transform:'translateY(0)'},'50%':{transform:'translateY(-6px)'} },
        glowPulse: { '0%,100%':{boxShadow:'0 0 5px rgba(var(--aegis-600),0.3)'},'50%':{boxShadow:'0 0 20px rgba(var(--aegis-600),0.5)'} },
        ring: { '0%,100%':{transform:'rotate(0deg)'},'10%,30%':{transform:'rotate(-10deg)'},'20%,40%':{transform:'rotate(10deg)'},'50%':{transform:'rotate(0deg)'} },
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-conic': 'conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))',
      },
    },
  },
  plugins: [],
}
