# Solid Experimental

![image](https://github.com/user-attachments/assets/b11ad314-cbf2-474f-adee-a2266975cd4e)

This repo contains sample of certain library integration with SolidJS
Currently includes :
- [Golden Layout](https://github.com/golden-layout/golden-layout) (web based dock layout manager)
- Mounting React Component (svar-gantt)
- Google Maps and DeckGL Integration
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
- Mounting React Components and interact with it
- [Solid Gridstack](https://github.com/FelixWieland/solid-gridstack) or [gridstack.js](https://github.com/gridstack/gridstack.js)
- [Winbox](https://github.com/nextapps-de/winbox)
- [maxgraph](https://maxgraph.github.io/) (continuation of mxgraph)
- [JSGantt Improved](https://github.com/jsGanttImproved/jsgantt-improved/)

# Todo

- https://github.com/NikolaySuslov/solid-braid-quill.git

- [P9] https://github.com/adarshhegde/solid-graph-visualiser

- https://github.com/traccar/maplibre-google-maps


# Notes - Golden Layout integration with SolidJS
- Similar JSX instance will replace older one when rendered twice (to mitigate this, provide function that return JSX.Element to create new instance of JSX)
- Context doesnt connect each other between different render (pass context from GoldenLayoutView as workaround, but super inconvenient :sad )

# Notes - react-solid-bridge
- It's outdated, works with React 17.0.2
- This library is only works inside React Enviroment. (See this example)[https://codesandbox.io/p/sandbox/react-solid-bridge-solid-app-router-7wowh], Pay attention to index.js file
- Just manually mounting ReactDOM and its Component just do the job to use React Components inside SolidJS (but cannot use jsx/tsx)

# Others
 tar -cvf - -p tileserver-gl-light/ | xz > tileserver-gl-light_4101_node16151.tar.xz
 cat my_large_archive.tar.gz.part_* > my_large_archive_reconstructed.tar.gz

 # Sources

ArcLayer path - https://github.com/visgl/deck.gl/issues/8447
Manual ArcLayer path - https://codepen.io/chrisgervang/pen/yLwQdoe

Routing example
https://valhalla1.openstreetmap.de/route?json={%22locations%22:[{%22lat%22:-6.315891,%22lon%22:106.816505,%22street%22:%22Park%22},{%22lat%22:-6.336195,%22lon%22:106.803065,%22street%22:%22Point%20Home%22}],%22costing%22:%22auto%22,%22costing_options%22:{%22auto%22:{%22country_crossing_penalty%22:2000.0}},%22units%22:%22kilometers%22,%22id%22:%22my_work_route%22,%20%22format%22:%20%22osrm%22,%20%22shape_format%22:%22geojson%22}