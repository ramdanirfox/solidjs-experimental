import { defineConfig } from "@solidjs/start/config";
import basicSsl from '@vitejs/plugin-basic-ssl';
import mkcert from 'vite-plugin-mkcert'
import { APP_DEV_BASEURL } from "./src/shared/constants/app.constant";
import tailwindcss from '@tailwindcss/vite';

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
      routes: [
        "/404",
        "/", 
        "/globe-mapblibre", 
        "/golden-layout"
      ]
    },
    baseURL: process.argv.includes("dev") ? APP_DEV_BASEURL : APP_DEV_BASEURL
  },
  vite: ({ router }) => ({
    clearScreen: false,
    server: {
      hmr: {
        port: hmrPorts[router]
      },
    },
    plugins: [
      tailwindcss(),
      basicSsl(),
      mkcert(),
    ],
    optimizeDeps: {include: ["mapbox-gl"]}
  })
});
