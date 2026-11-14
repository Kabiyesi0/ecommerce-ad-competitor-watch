import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#1A1A17",
        paper: "#FAF9F6",
        accent: "#1F4D3A",
        "accent-soft": "#E7EEE9",
        hairline: "#E7E5DF",
      },
      fontFamily: {
        serif: ["var(--font-serif)", "serif"],
        sans: ["var(--font-sans)", "sans-serif"],
      },
      borderRadius: {
        card: "16px",
        row: "14px",
      },
      maxWidth: {
        content: "720px",
      },
      boxShadow: {
        soft: "0 1px 2px rgba(26, 26, 23, 0.04), 0 2px 8px rgba(26, 26, 23, 0.03)",
      },
      transitionDuration: {
        150: "150ms",
        200: "200ms",
      },
    },
  },
  plugins: [],
} satisfies Config;
