import { type Config } from "tailwindcss";
import sharedConfig from "@cronium/tailwind-config";

export default {
  ...sharedConfig,
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx}",
    "./src/components/**/*.{js,ts,jsx,tsx}",
    "./src/app/styles/**/*.css",
    "../../packages/ui/src/**/*.{js,ts,jsx,tsx}",
  ],
} satisfies Config;
