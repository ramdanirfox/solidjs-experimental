import solid from "vite-plugin-solid";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [solid() as any],
  resolve: {
    conditions: ["development", "browser"],
  },
});
