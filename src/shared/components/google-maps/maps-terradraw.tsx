import { Component, JSXElement, createEffect, createSignal, onCleanup, onMount } from "solid-js"
import { TerraDraw, TerraDrawFreehandMode, TerraDrawSelectMode } from "terra-draw";
import { TerraDrawGoogleMapsAdapter } from "terra-draw-google-maps-adapter";

export interface ISharedGoogleTerradrawAPI {
    terraDrawInstance: TerraDraw | undefined;
    fnChangeDrawMode: (mode: string) => void;
}

export interface ISharedGoogleTerradraw {
    children?: (api?: ISharedGoogleTerradrawAPI) => JSXElement;
    gmapref?: any;
    googleref?: any;
    onReady?: (api: any) => void
    onTerradrawUpdate?: (ids: any[], type: string, snapshot: any) => void;
    onTerradrawFinish?: (ids: any, type: any, snapshot: any) => void;
}

const SharedGoogleTerradraw: Component<ISharedGoogleTerradraw> = (props: ISharedGoogleTerradraw) => {
    const [sigTerraDrawInstance, setSigTerraDrawInstance] = createSignal<TerraDraw | undefined>(undefined);
    const [sigCmpAPI, setSigCmpAPI] = createSignal<ISharedGoogleTerradrawAPI | undefined>(undefined);

    const colorPalette = [
        "#E74C3C",
        "#FF0066",
        "#9B59B6",
        "#673AB7",
        "#3F51B5",
        "#3498DB",
        "#03A9F4",
        "#00BCD4",
        "#009688",
        "#27AE60",
        "#8BC34A",
        "#CDDC39",
        "#F1C40F",
        "#FFC107",
        "#F39C12",
        "#FF5722",
        "#795548"
    ];

    const fnGetRandomColor = () => {
        const now = Date.now();
        const index = now % colorPalette.length;
        return colorPalette[index] as `#${string}`;
    };

    const fnChangeDrawMode = (mode: "freehand" | string) => {
        sigTerraDrawInstance()?.setMode(mode);
    };

    onMount(() => {
        setSigTerraDrawInstance(
            new TerraDraw({
                adapter: new TerraDrawGoogleMapsAdapter({ map: props.gmapref, lib: props.googleref.maps, coordinatePrecision: 9 }),
                modes: [
                    new TerraDrawSelectMode({
                        flags: {
                            //          polygon: {
                            //     feature: {
                            //         draggable: true,
                            //         rotateable: true,
                            //         coordinates: {
                            //             midpoints: true,
                            //             draggable: true,
                            //             deletable: true,
                            //         },
                            //     },
                            // },
                            // linestring: {
                            //     feature: {
                            //         draggable: true,
                            //         rotateable: true,
                            //         coordinates: {
                            //             midpoints: true,
                            //             draggable: true,
                            //             deletable: true,
                            //         },
                            //     },
                            // },
                            // point: {
                            //     feature: {
                            //         draggable: true,
                            //         rotateable: true,
                            //     },
                            // },
                            // rectangle: {
                            //     feature: {
                            //         draggable: true,
                            //         rotateable: true,
                            //         coordinates: {
                            //             midpoints: true,
                            //             draggable: true,
                            //             deletable: true,
                            //         },
                            //     },
                            // },
                            // circle: {
                            //     feature: {
                            //         draggable: true,
                            //         rotateable: true,
                            //         coordinates: {
                            //             midpoints: true,
                            //             draggable: true,
                            //             deletable: true,
                            //         },
                            //     },
                            // },
                            freehand: {
                                feature: {
                                    draggable: true,
                                    rotateable: true,
                                    coordinates: {
                                        midpoints: true,
                                        draggable: true,
                                        deletable: true,
                                    },
                                },
                            },
                        }
                    }),
                    // new TerraDrawPointMode({
                    //     editable: true,
                    //     styles: { pointColor: getRandomColor() },
                    // }),
                    // new TerraDrawLineStringMode({
                    //     editable: true,
                    //     styles: { lineStringColor: getRandomColor() },
                    // }),
                    // new TerraDrawPolygonMode({
                    //     editable: true,
                    //     styles: (() => {
                    //         const color = getRandomColor();
                    //         return {
                    //             fillColor: color,
                    //             outlineColor: color,
                    //         };
                    //     })(),
                    // }),
                    // new TerraDrawRectangleMode({
                    //     styles: (() => {
                    //         const color = getRandomColor();
                    //         return {
                    //             fillColor: color,
                    //             outlineColor: color,
                    //         };
                    //     })(),
                    // }),
                    // new TerraDrawCircleMode({
                    //     styles: (() => {
                    //         const color = getRandomColor();
                    //         return {
                    //             fillColor: color,
                    //             outlineColor: color,
                    //         };
                    //     })(),
                    // }),
                    new TerraDrawFreehandMode({
                        styles: (() => {
                            const color = fnGetRandomColor();
                            return {
                                fillColor: color,
                                outlineColor: color,
                            };
                        })(),
                    }),
                ]
            })
        );
        sigTerraDrawInstance()?.start();

        props.onTerradrawUpdate && sigTerraDrawInstance()?.on("change", (ids, type) => {
            console.log("FeatureUpdate", ids, type);
            const snapshot = sigTerraDrawInstance()?.getSnapshot();
            console.log("Snapshot", snapshot);
            props.onTerradrawUpdate!(ids, type, snapshot);
        });

        props.onTerradrawFinish && sigTerraDrawInstance()?.on("finish", (id, ctx) => {
            console.log("FeatureFinish", id, ctx);
            const snapshot = sigTerraDrawInstance()?.getSnapshot();
            console.log("Snapshot", snapshot);
            props.onTerradrawFinish!(id, ctx, snapshot);
        });

        setSigCmpAPI({
            terraDrawInstance: sigTerraDrawInstance(),
            fnChangeDrawMode: fnChangeDrawMode,
            onUpdate: (features: any) => {
                console.log("WIP")
            }
        });
        props.onReady && props.onReady(sigCmpAPI());
    });
    return <>
        TerraDraw Disini
        {props.children && props.children(sigCmpAPI())}
    </>
}
export default SharedGoogleTerradraw;