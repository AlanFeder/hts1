/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: {
          50: "#eef2f7",
          100: "#d5e0ed",
          200: "#adc1db",
          300: "#7d9dc4",
          400: "#4f78ac",
          500: "#2f5893",
          600: "#1e3d6e",
          700: "#162e54",
          800: "#0f2040",
          900: "#0a1628",
        },
        gold: {
          300: "#f0d080",
          400: "#e6b840",
          500: "#c8960c",
          600: "#a67c00",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "sans-serif",
        ],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
