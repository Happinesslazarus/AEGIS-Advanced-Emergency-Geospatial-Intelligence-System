/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        aegis: { 50:'#eef7ff',100:'#d9edff',200:'#bce0ff',300:'#8ecdff',400:'#59b0ff',500:'#338dff',600:'#1a6df5',700:'#1456e1',800:'#1746b6',900:'#193d8f',950:'#142757' },
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
        glowPulse: { '0%,100%':{boxShadow:'0 0 5px rgba(26,109,245,0.3)'},'50%':{boxShadow:'0 0 20px rgba(26,109,245,0.5)'} },
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
