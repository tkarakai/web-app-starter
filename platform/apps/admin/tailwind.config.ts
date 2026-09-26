import type { Config } from "tailwindcss";
import designSystemConfig from "@web-app-starter/design-system/tailwind.config";

const config: Config = {
  presets: [designSystemConfig],
  content: [
    "./src/**/*.{ts,tsx}",
    "../../packages/design-system/src/**/*.{ts,tsx}",
  ],
};

export default config;
