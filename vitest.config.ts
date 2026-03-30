import solid from "vite-plugin-solid";
import { defineConfig } from "vitest/config";

export default defineConfig({
  clearScreen: false,
  plugins: [solid() as any],
  resolve: {
    conditions: ["development", "browser"],
  },
});
