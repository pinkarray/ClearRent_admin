import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#0A7B6C",
          light: "#4DA69A",
          dark: "#065749",
          50: "#EDFAF7",
          100: "#D1F4ED",
          500: "#0A7B6C",
          600: "#086B5E",
          700: "#065749",
        },
        accent: {
          DEFAULT: "#F4A836",
          light: "#F7C067",
          dark: "#D4922E",
        },
        surface: {
          light: "#FFFFFF",
          dark: "#1E1E1E",
        },
        background: {
          light: "#F8F9FA",
          dark: "#121212",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        display: ["Plus Jakarta Sans", "Inter", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
