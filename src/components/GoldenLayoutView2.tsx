import { Component, createSignal, onMount, Show } from "solid-js";
import GoldenAppRoot, { IGoldenAppRootApi } from "~/shared/components/golden-layout/golden-app-root";
import Counter from "./Counter";
import { useSJXContext } from "~/shared/context/SJXContext";
import "./../shared/styles/golden-layout.css";
import "golden-layout/dist/css/goldenlayout-base.css";
import "golden-layout/dist/css/themes/goldenlayout-light-theme.css";

export const GoldenLayoutView2: Component<any> = () => {
    const SJXctx = useSJXContext();
    let glApi: IGoldenAppRootApi;
    let memorizedLayout: any = {
    "root": {
        "type": "row",
        "content": [
            {
                "type": "stack",
                "content": [
                    {
                        "type": "component",
                        "content": [],
                        "size": 30,
                        "sizeUnit": "%",
                        "minSizeUnit": "px",
                        "id": "solid",
                        "maximised": false,
                        "isClosable": true,
                        "reorderEnabled": true,
                        "title": "Solid",
                        "header": {
                            "show": "top"
                        },
                        "componentType": "solid view",
                        "componentState": {
                            "jsxIndex": 1,
                            "jsxPreservationMode": "standard"
                        }
                    }
                ],
                "size": 46.15384615384615,
                "sizeUnit": "%",
                "minSizeUnit": "px",
                "id": "solid",
                "isClosable": true,
                "maximised": false,
                "activeItemIndex": 0
            },
            {
                "type": "stack",
                "content": [
                    {
                        "type": "component",
                        "content": [],
                        "size": 1,
                        "sizeUnit": "fr",
                        "minSizeUnit": "px",
                        "id": "js2",
                        "maximised": false,
                        "isClosable": true,
                        "reorderEnabled": true,
                        "title": "JS2",
                        "header": {
                            "show": "top",
                            "popout": "pop"
                        },
                        "componentType": "solid view",
                        "componentState": {
                            "jsxIndex": 2,
                            "jsxPreservationMode": "standard"
                        }
                    }
                ],
                "size": 53.84615384615385,
                "sizeUnit": "%",
                "minSizeUnit": "px",
                "id": "js2",
                "isClosable": true,
                "maximised": false,
                "activeItemIndex": 0
            }
        ],
        "size": 1,
        "sizeUnit": "fr",
        "minSizeUnit": "px",
        "id": "",
        "isClosable": true
    },
    "openPopouts": [],
    "settings": {
        "constrainDragToContainer": true,
        "reorderEnabled": true,
        "popoutWholeStack": false,
        "blockedPopoutsThrowError": true,
        "closePopoutsOnUnload": true,
        "responsiveMode": "none",
        "tabOverlapAllowance": 0,
        "reorderOnTabMenuClick": true,
        "tabControlOffset": 10,
        "popInOnClose": false
    },
    "dimensions": {
        "borderWidth": 5,
        "borderGrabWidth": 5,
        "defaultMinItemHeight": 0,
        "defaultMinItemHeightUnit": "px",
        "defaultMinItemWidth": 10,
        "defaultMinItemWidthUnit": "px",
        "headerHeight": 1,
        "dragProxyWidth": 300,
        "dragProxyHeight": 200
    },
    "header": {
        "show": "top",
        "popout": "open in new window",
        "dock": "dock",
        "close": "close",
        "maximise": "maximise",
        "minimise": "minimise",
        "tabDropdown": "additional tabs"
    },
    "resolved": true
};

    const fnOnReady = (api: IGoldenAppRootApi) => {
        glApi = api;
    }

    const fnGetLayout = () => {
        memorizedLayout = glApi.fnGetLayout();
        console.log("Layout", memorizedLayout);
    }

    const fnRestoreLayout = () => {
        glApi.fnLoadLayout(memorizedLayout)
    }

    return <>
        <div>
            <button class="bg-blue-500 hover:bg-blue-700 p-2 mr-2 cursor-pointer rounded-lg" onClick={fnGetLayout}>
                Capture Layout
            </button>
            <button class="bg-green-500 hover:bg-green-700 p-2 cursor-pointer rounded-lg" onClick={fnRestoreLayout}>
                Restore Layout
            </button>
            <GoldenAppRoot
                onReady={fnOnReady}
                jsxComponents={[
                    () => <div>Hallo Dunia</div>,
                    // () => <GoldenAppRoot jsxComponents={[
                    //     () => <div>Pagiku cerah!</div>,
                    //     () => <div>Matahari bersinar!</div>,
                    // ]} />,
                    () => <Counter />,
                    () => <h2>Apa Kabar {SJXctx?.ctx.increments.val()}</h2>,
                    () => <h2>Apa Kabar {SJXctx?.ctx.increments.val()}</h2>,
                    () => <iframe width="560" height="315" src="https://www.youtube.com/embed/TclGxroYwb4?si=jmQn8M1wqDmlx8ss" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>
                ]}
            />
        </div>
    </>
};