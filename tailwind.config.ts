import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // the same green light theme as the medical app
        brand: {
          50: "#f0fdf7", 100: "#dcfce9", 200: "#bbf7d6", 300: "#86efb8", 400: "#4ade98",
          500: "#34d399", 600: "#10b981", 700: "#059669", 800: "#047857", 900: "#065f46",
        },
      },
      fontFamily: { sans: ["Inter", "Segoe UI", "Roboto", "Arial", "sans-serif"] },
    },
  },
  plugins: [],
} satisfies Config;
