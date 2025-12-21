import type { Config } from "tailwindcss";
export default {
  content: ["./app/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}"],
  theme: { extend: {
    keyframes: {
      marquee: { '0%': { transform: 'translateX(0)' }, '100%': { transform: 'translateX(-50%)' } }
    },
    animation: {
      marquee: 'marquee 25s linear infinite'
    }
  }},
  plugins: [],
} satisfies Config;
