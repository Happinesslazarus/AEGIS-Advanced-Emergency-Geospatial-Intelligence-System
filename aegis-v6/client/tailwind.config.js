/**
 * File: tailwind.config.js
 *
 * What this file does:
 * Tailwind CSS design-system configuration for the Aegis client. Defines:
 * - Custom colour palette: aegis-50..950 (resolved from CSS custom properties
 *   in globals.css so dark/light mode switching works with a single class)
 * - Semantic colour tokens: surface.*, fg.*, border (theme-aware via CSS vars)
 * - Typography, spacing, and animation extensions
 * - Dark mode via the 'class' strategy (ThemeContext toggles the dark class)
 *
 * How it connects:
 * - Processed by Vite via the PostCSS plugin (see postcss.config.js)
 * - CSS variables it references are defined in client/src/styles/globals.css
 * - ThemeContext.tsx adds/removes the 'dark' class on <html> to trigger theming
 * - Content paths cover all .ts/.tsx files so no unused classes are purged
 *
 * Learn more: https://tailwindcss.com/docs/configuration
 */
/* @type {import('tailwindcss').Config} */
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
        /* Semantic surface / foreground tokens — theme-aware via CSS vars */
        surface: {
          DEFAULT:      'rgb(var(--surface-primary)   / <alpha-value>)',
          secondary:    'rgb(var(--surface-secondary) / <alpha-value>)',
          muted:        'rgb(var(--surface-muted)     / <alpha-value>)',
          elevated:     'rgb(var(--surface-elevated)  / <alpha-value>)',
          'ultra-dark': 'rgb(var(--surface-ultra-dark) / <alpha-value>)',
        },
        overlay: 'rgb(var(--surface-overlay) / <alpha-value>)',
        fg: {
          DEFAULT:   'rgb(var(--text-primary)   / <alpha-value>)',
          secondary: 'rgb(var(--text-secondary) / <alpha-value>)',
          muted:     'rgb(var(--text-muted)     / <alpha-value>)',
        },
        success: {
          DEFAULT: 'rgb(var(--accent-success) / <alpha-value>)',
          surface: 'rgb(var(--success-surface) / <alpha-value>)',
          text:    'rgb(var(--success-text)    / <alpha-value>)',
        },
        warning: {
          DEFAULT: 'rgb(var(--accent-warning) / <alpha-value>)',
          surface: 'rgb(var(--warning-surface) / <alpha-value>)',
          text:    'rgb(var(--warning-text)    / <alpha-value>)',
        },
        danger: {
          DEFAULT: 'rgb(var(--accent-danger)  / <alpha-value>)',
          surface: 'rgb(var(--danger-surface) / <alpha-value>)',
          text:    'rgb(var(--danger-text)    / <alpha-value>)',
        },
        info: {
          DEFAULT: 'rgb(var(--accent-info)    / <alpha-value>)',
          surface: 'rgb(var(--info-surface)   / <alpha-value>)',
          text:    'rgb(var(--info-text)      / <alpha-value>)',
        },
      },
      borderColor: {
        muted:  'rgb(var(--border-muted)   / <alpha-value>)',
        subtle: 'rgb(var(--border-subtle)  / <alpha-value>)',
        strong: 'rgb(var(--border-strong)  / <alpha-value>)',
      },
      ringColor: {
        focus: 'rgb(var(--focus-ring) / <alpha-value>)',
      },
      fontFamily: {
        display: ['"DM Sans"','system-ui','sans-serif'],
        body: ['"DM Sans"','system-ui','sans-serif'],
        mono: ['"JetBrains Mono"','monospace'],
      },
      /* Typography scale
         Semantic font-size tokens so components reference a role
         instead of arbitrary pixel values. Each entry is [size, { lineHeight, letterSpacing? }]. */
      fontSize: {
        /* Micro text — absolute floor for accessibility (badges, legends) */
        'micro':  ['0.625rem', { lineHeight: '0.875rem' }],          /* 10px / 14px — WCAG minimum */
        /* Captions — timestamps, metadata, chart labels */
        'caption': ['0.6875rem', { lineHeight: '1rem' }],            /* 11px / 16px */
        /* Labels — form labels, stat labels, table headers */
        'label':  ['0.75rem', { lineHeight: '1rem', letterSpacing: '0.025em' }],  /* 12px (= text-xs) */
        /* Body small — secondary text, descriptions, table cells */
        'body-sm': ['0.8125rem', { lineHeight: '1.25rem' }],         /* 13px */
        /* Body — primary readable text */
        'body':   ['0.875rem', { lineHeight: '1.375rem' }],          /* 14px (= text-sm) */
        /* Body large — emphasized body / card intros */
        'body-lg': ['1rem', { lineHeight: '1.5rem' }],               /* 16px (= text-base) */
        /* Heading small — card titles, section headers */
        'heading-sm': ['1rem', { lineHeight: '1.5rem', letterSpacing: '-0.01em' }],
        /* Heading — section titles, panel headers */
        'heading': ['1.125rem', { lineHeight: '1.625rem', letterSpacing: '-0.015em' }],  /* 18px (= text-lg) */
        /* Heading large — page section titles */
        'heading-lg': ['1.25rem', { lineHeight: '1.75rem', letterSpacing: '-0.02em' }],  /* 20px (= text-xl) */
        /* Display — page titles, hero headings */
        'display': ['1.5rem', { lineHeight: '2rem', letterSpacing: '-0.025em' }],         /* 24px (= text-2xl) */
        /* Display large — splash / landing headings */
        'display-lg': ['1.875rem', { lineHeight: '2.25rem', letterSpacing: '-0.025em' }], /* 30px (= text-3xl) */
      },
      /* Motion tokens
         Standardized durations & easings so every transition uses a
         shared vocabulary instead of arbitrary one-off values. */
      transitionDuration: {
        'fast':   '150ms',   /* micro-interactions: toggles, color shifts */
        'normal': '200ms',   /* standard: buttons, inputs, nav items */
        'slow':   '300ms',   /* structural: sidebar collapse, panel resize */
        'slower': '500ms',   /* emphasis: page transitions, modals */
      },
      transitionTimingFunction: {
        'smooth':  'cubic-bezier(0.4, 0, 0.2, 1)',   /* Material ease-in-out */
        'enter':   'cubic-bezier(0, 0, 0.2, 1)',     /* decelerate (entering) */
        'exit':    'cubic-bezier(0.4, 0, 1, 1)',     /* accelerate (leaving) */
        'spring':  'cubic-bezier(0.175, 0.885, 0.32, 1.275)', /* slight overshoot */
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
        /* Phase 6 — Enhanced micro-interactions */
        'bounce-subtle':'bounceSubtle 0.5s ease-out',
        'pop':'pop 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
        'shake':'shake 0.5s ease-in-out',
        'ping-slow':'pingSlow 2s cubic-bezier(0, 0, 0.2, 1) infinite',
        'wiggle':'wiggle 0.3s ease-in-out',
        'count-up':'countUp 0.4s ease-out forwards',
        'reveal':'reveal 0.5s ease-out forwards',
        'slide-fade-left':'slideFadeLeft 0.3s ease-out forwards',
        'slide-fade-right':'slideFadeRight 0.3s ease-out forwards',
        'pin-drop':'pinDrop 0.4s cubic-bezier(0.175,0.885,0.32,1.275) forwards',
        'bar-grow':'barGrow 0.6s ease-out forwards',
        'toast-in':'toastIn 0.35s cubic-bezier(0,0,0.2,1) forwards',
        'toast-out':'toastOut 0.25s cubic-bezier(0.4,0,1,1) forwards',
        'status-flash':'statusFlash 0.6s ease-out',
        'slide-up-stagger':'slideUp 0.35s ease-out forwards',
        'bell-shake':'bellShake 0.6s ease-in-out',
        'check-draw':'checkDraw 0.5s ease-out forwards',
        'confetti-pop':'confettiPop 0.4s cubic-bezier(0.175,0.885,0.32,1.275) forwards',
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
        /* Phase 6 — New keyframes */
        bounceSubtle: { '0%,100%':{transform:'translateY(0)'},'50%':{transform:'translateY(-4px)'} },
        pop: { '0%':{transform:'scale(0.95)',opacity:'0'},'50%':{transform:'scale(1.02)'},'100%':{transform:'scale(1)',opacity:'1'} },
        shake: { '0%,100%':{transform:'translateX(0)'},'10%,30%,50%,70%,90%':{transform:'translateX(-2px)'},'20%,40%,60%,80%':{transform:'translateX(2px)'} },
        pingSlow: { '0%':{transform:'scale(1)',opacity:'1'},'75%,100%':{transform:'scale(1.5)',opacity:'0'} },
        wiggle: { '0%,100%':{transform:'rotate(0)'},'25%':{transform:'rotate(-3deg)'},'75%':{transform:'rotate(3deg)'} },
        countUp: { '0%':{opacity:'0',transform:'translateY(8px)'},'100%':{opacity:'1',transform:'translateY(0)'} },
        reveal: { '0%':{opacity:'0',clipPath:'inset(0 100% 0 0)'},'100%':{opacity:'1',clipPath:'inset(0 0 0 0)'} },
        slideFadeLeft: { '0%':{opacity:'0',transform:'translateX(12px)'},'100%':{opacity:'1',transform:'translateX(0)'} },
        slideFadeRight: { '0%':{opacity:'0',transform:'translateX(-12px)'},'100%':{opacity:'1',transform:'translateX(0)'} },
        pinDrop: { '0%':{opacity:'0',transform:'translateY(-20px) scale(0.5)'},'70%':{transform:'translateY(4px) scale(1.1)'},'100%':{opacity:'1',transform:'translateY(0) scale(1)'} },
        barGrow: { '0%':{transform:'scaleY(0)',transformOrigin:'bottom'},'100%':{transform:'scaleY(1)',transformOrigin:'bottom'} },
        toastIn: { '0%':{opacity:'0',transform:'translateX(100%) scale(0.95)'},'100%':{opacity:'1',transform:'translateX(0) scale(1)'} },
        toastOut: { '0%':{opacity:'1',transform:'translateX(0) scale(1)'},'100%':{opacity:'0',transform:'translateX(100%) scale(0.95)'} },
        statusFlash: { '0%,100%':{backgroundColor:'transparent'},'25%,75%':{backgroundColor:'rgba(var(--aegis-500),0.15)'} },
        bellShake: { '0%,100%':{transform:'rotate(0)'},'10%':{transform:'rotate(-15deg)'},'20%':{transform:'rotate(15deg)'},'30%':{transform:'rotate(-10deg)'},'40%':{transform:'rotate(10deg)'},'50%':{transform:'rotate(-5deg)'},'60%':{transform:'rotate(5deg)'},'70%':{transform:'rotate(0)'} },
        checkDraw: { '0%':{strokeDashoffset:'100'},'100%':{strokeDashoffset:'0'} },
        confettiPop: { '0%':{transform:'scale(0) rotate(-10deg)',opacity:'0'},'60%':{transform:'scale(1.15) rotate(3deg)',opacity:'1'},'100%':{transform:'scale(1) rotate(0)',opacity:'1'} },
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-conic': 'conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))',
      },
    },
  },
  plugins: [],
}

