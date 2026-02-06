import type { Config } from "tailwindcss";
import uiConfig from "@repo/ui/tailwind.config";

const config: Config = {
  presets: [uiConfig],
  content: [
    "./src/**/*.{ts,tsx}",
    "../../packages/ui/src/**/*.{ts,tsx}",
  ],
};

export default config;
