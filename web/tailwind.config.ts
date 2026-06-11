import type { Config } from 'tailwindcss';

/**
 * Design tokens — "campus dispatch" direction.
 * Ink-on-paper neutrals, e-rickshaw green primary, amber for anything live.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#101B14',
        paper: '#F7F6F1',
        primary: { DEFAULT: '#0E7A4E', dark: '#0A5C3B', soft: '#E3F2EA' },
        amber: { DEFAULT: '#F2B807', soft: '#FBF0CB' },
        slate2: '#5A6B61',
        danger: { DEFAULT: '#C2462B', soft: '#F8E4DE' },
        line: '#E2E1DA',
      },
      fontFamily: {
        display: ['var(--font-display)', 'sans-serif'],
        body: ['var(--font-body)', 'sans-serif'],
        mono: ['var(--font-mono)', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(16,27,20,0.06), 0 4px 16px rgba(16,27,20,0.06)',
        lift: '0 2px 4px rgba(16,27,20,0.08), 0 12px 32px rgba(16,27,20,0.10)',
      },
      borderRadius: { card: '14px' },
      keyframes: {
        'pulse-dot': {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.55', transform: 'scale(0.85)' },
        },
      },
      animation: { 'pulse-dot': 'pulse-dot 1.6s ease-in-out infinite' },
    },
  },
  plugins: [],
};

export default config;
