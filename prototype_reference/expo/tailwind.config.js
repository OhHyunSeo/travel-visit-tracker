/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        "primary": "#0ac4c7",
        "background-light": "#f5f8f8",
        "background-dark": "#102222",
        "glass-dark": "rgba(24, 52, 52, 0.4)",
        "glass-border": "rgba(144, 202, 203, 0.1)",
        // Keep existing semantic names map to new values if needed, or just add new ones
        background: '#102222',
        surface: 'rgba(255, 255, 255, 0.05)',
      },
      fontFamily: {
        "display": ["Space Grotesk", "System"],
        sans: ["Space Grotesk", "System"],
      },
    },
  },
  plugins: [],
}
