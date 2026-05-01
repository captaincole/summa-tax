import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        bg: {
          base: "#0a0a0b",
          subtle: "#111113",
          panel: "#16161a",
          elevated: "#1c1c22",
        },
        border: {
          subtle: "#26262e",
          DEFAULT: "#2e2e38",
          strong: "#3a3a44",
        },
        ink: {
          primary: "#f5f5f7",
          secondary: "#a1a1aa",
          muted: "#71717a",
          faint: "#52525b",
        },
        accent: {
          DEFAULT: "#7c5cff",
          hover: "#8d6fff",
          subtle: "rgba(124, 92, 255, 0.12)",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        serif: ["Fraunces", "Georgia", "serif"],
        mono: ["'JetBrains Mono'", "ui-monospace", "monospace"],
      },
      backgroundImage: {
        "hero-glow":
          "radial-gradient(ellipse 60% 40% at 50% 30%, rgba(124, 92, 255, 0.18), transparent 70%)",
        "rail-fade":
          "linear-gradient(to bottom, rgba(22, 22, 26, 0.6), rgba(10, 10, 11, 0.0))",
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "pulse-soft": {
          "0%, 100%": { opacity: "0.4" },
          "50%": { opacity: "1" },
        },
      },
      animation: {
        "fade-in": "fade-in 320ms ease-out",
        "pulse-soft": "pulse-soft 1.6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
} satisfies Config;
