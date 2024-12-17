import { defineConfig } from "@solidjs/start/config";

const hmrPorts = {
    client: 4440,
    server: 4441,
    'server-function': 4442,
  }
  

export default defineConfig({
    vite: ({ router }) => ({
        server: {
          hmr: {
            port: hmrPorts[router]
          },
        }
    })
});
