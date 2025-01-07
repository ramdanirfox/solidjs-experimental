import { createSignal, onMount, Show } from "solid-js";
import React, { useState, useRef } from 'react';
import ReactDOM from 'react-dom/client';

// import * as a from "react-solid-bridge";
// import { Gantt } from "wx-react-gantt";
import "wx-react-gantt/dist/gantt.css";

export default function SvarReactGantt() {
  const [sigCmpSvar, setSigCmpSvar] = createSignal<any>();
  const [sigCmpReactBridge, setSigCmpReactBridge] = createSignal<any>();
  onMount(() => {
    console.log("Svar mounted");
    import("wx-react-gantt").then((mod) => {
      console.log("WXG mod", mod);
      setSigCmpSvar(mod);
    })

    import("react-solid-bridge").then((mod) => {
      console.log("RSB mod", mod);
      setSigCmpReactBridge(mod);
    })
  });

  const fnMountReact = (root_dom: any) => {
    const Gantt: any = sigCmpSvar().Gantt;
    const Willow: any = sigCmpSvar().Willow;
    const taskz = [
      {
        id: 20,
        text: "New Task",
        start: new Date(2024, 5, 11),
        end: new Date(2024, 6, 12),
        duration: 1,
        progress: 2,
        type: "task",
        lazy: false,
      },
      {
        id: 47,
        text: "[1] Master project",
        start: new Date(2024, 5, 12),
        end: new Date(2024, 7, 12),
        duration: 8,
        progress: 0,
        parent: 0,
        type: "summary",
      },
      {
        id: 22,
        text: "Task",
        start: new Date(2024, 7, 11),
        end: new Date(2024, 8, 12),
        duration: 8,
        progress: 0,
        parent: 47,
        type: "task",
      },
      {
        id: 21,
        text: "New Task 2",
        start: new Date(2024, 7, 10),
        end: new Date(2024, 8, 12),
        duration: 3,
        progress: 0,
        type: "task",
        lazy: false,
      },
    ];
  
    const linkz = [{ id: 1, source: 20, target: 21, type: "e2e" }];
  
    const scalez = [
      { unit: "month", step: 1, format: "MMMM yyy" },
      { unit: "day", step: 1, format: "d" },
    ];
    console.log("React", ReactDOM);
    const root = ReactDOM.createRoot(root_dom);
    // jsx and tsx transpilation already takeover by SolidJS, so it is impossible to write ReactNode compatible jsx here
    // we will write transpiled one directly, and coding becomes not fun anymore
    root.render(
      // React.createElement("div", {}, "Cobaduluuu")
      React.createElement(Willow, {}, 
        React.createElement(Gantt, {
          tasks: taskz,
          links: linkz,
          scales: scalez
        })
      )
    );
    console.log("ReactRoot", root)
  }

  const fnReactContainer = ():(() => void) => {
    return () => {}
  }

  return (
    <Show when={sigCmpSvar() && sigCmpReactBridge()} fallback={"Please wait...."}>
      <div>
        <h1>Svar React Gantt</h1>
        <div ref={(e) => fnMountReact(e)}>
          {/* {
            (() => {
              const Gantt = sigCmpSvar()?.Gantt;
              const ReactToSolidBridgeProvider = sigCmpReactBridge()?.ReactToSolidBridgeProvider;
              const ReactToSolidBridge = sigCmpReactBridge()?.ReactToSolidBridge;
              return <>
                <ReactToSolidBridgeProvider>
                  <ReactToSolidBridge>
                    <Gantt />
                    <div>Broo</div>
                  </ReactToSolidBridge>
                </ReactToSolidBridgeProvider>
              </>
            })()
          } */}
        </div>
      </div>
    </Show>
  );
}
