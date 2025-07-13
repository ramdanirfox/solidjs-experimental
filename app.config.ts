import { defineConfig } from "@solidjs/start/config";
import basicSsl from '@vitejs/plugin-basic-ssl';
import mkcert from 'vite-plugin-mkcert'

const hmrPorts = {
  client: 4440,
  server: 4441,
  'server-function': 4442,
}


export default defineConfig({
  server: {
    https: true,
    // ...{ port: 8080 }, // port configurable through CLI (see package.json)
    prerender: {
      crawlLinks: true,
      routes: ["/404", "/"]
    },
    baseURL: process.argv.includes("dev") ? "/" : "/"
  },
  vite: ({ router }) => ({
    server: {
      hmr: {
        port: hmrPorts[router]
      },
    },
    plugins: [
      basicSsl(),
      mkcert(),
    ],
    optimizeDeps: {include: ["mapbox-gl"]}
  })
});
