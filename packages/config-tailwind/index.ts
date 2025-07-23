import { type Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class", "[data-mode='dark']"],
  theme: {
    extend: {
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in-up": {
          "0%": { opacity: "0", transform: "translateY(20px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "pulse-slow": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.8" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.7s ease-in-out forwards",
        "fade-in-up": "fade-in-up 0.7s ease-out forwards",
        "pulse-slow": "pulse-slow 3s ease-in-out infinite",
      },
    },
  },
};

export default config;
