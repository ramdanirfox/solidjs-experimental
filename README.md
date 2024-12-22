# Solid Experimental

![image](https://github.com/user-attachments/assets/b11ad314-cbf2-474f-adee-a2266975cd4e)

This repo contains sample of certain library integration with SolidJS
Currently includes :
- [Golden Layout](https://github.com/golden-layout/golden-layout) (web based dock layout manager)
- Vitest
- SolidStart

# Dependencies

- Node JS (v22.12.0)
- PNPM package manager

# Running
Install dependencies before running by executing `pnpm i` beforehand
- Project: `pnpm run dev` (open port 3011)
- Test (Vitest) `pnpm run test` or `pnpm run test-ui`

# Integration Roadmap
- Golden Layout - Listen and/or to as many APIs
- Golden Layout - Programmatic event possiblities
- [Solid Gridstack](https://github.com/FelixWieland/solid-gridstack) or [gridstack.js](https://github.com/gridstack/gridstack.js)
- [Winbox](https://github.com/nextapps-de/winbox)
- [maxgraph](https://maxgraph.github.io/) (continuation of mxgraph)

# Notes - Golden Layout integration with SolidJS
- Similar JSX instance will replace older one when rendered twice (to mitigate this, provide function that return JSX.Element to create new instance of JSX)
- Context doesnt connect each other between different render (pass context from GoldenLayoutView as workaround, but super inconvenient :sad )