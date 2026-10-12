import solid from "vite-plugin-solid";
import { defineConfig } from "vitest/config";

export default defineConfig({
  clearScreen: false,
  plugins: [solid() as any],
  resolve: {
    conditions: ["development", "browser"],
  },
  // solid-js harus ikut diproses Vite agar `conditions` di atas berlaku; kalau tidak, build server (`server.js`) terpakai di jsdom
  test: { server: { deps: { inline: [/solid-js/, /@solidjs/] } } },
});
