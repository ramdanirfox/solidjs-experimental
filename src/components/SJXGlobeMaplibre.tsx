import { createEffect, createMemo, createSignal, onMount, Show } from "solid-js";
import { Layer, Map, NavigationControl, Source, useMapEffect, useMap } from "solid-maplibre";
import { SJXApiService } from "~/shared/services/api.service";
import "maplibre-gl/dist/maplibre-gl.css";

export interface ISJXGlobeMaplibre {

}

interface MapFlyerProps {
    center: [number, number];
}

function MapFlyer(props: MapFlyerProps) {
    useMapEffect((map) => {
        map.flyTo({ center: props.center });
    });
    return <></>;
}

export default function SJXGlobeMaplibre(props: ISJXGlobeMaplibre) {
    const [center, setCenter] = createSignal<[number, number]>([106.82976614124544, -6.2773016456564275]);
    const [sigGeojsonWorldWide, setSigGeojsonWorldWide] = createSignal<any>();
    const noopGlobeStyle = {
        version: 8 as 8,
        sources: {},
        projection: { type: "globe" },
        layers: [
            {
                id: "background",
                type: "background",
                paint: {
                    "background-color": "#001d3d" // Warna laut gelap agar atmosfer terlihat bagus
                }
            }
        ]
    } as any;

    let hoveredId: any = null;

    const fnHoverHighlighter = (map: maplibregl.Map) => {
        map.on("mousemove", "geojson-polygon-fill", (e) => {
            if (e.features && e.features.length > 0) {
                const newHoveredId = e.features[0].id;
                console.log("hovered feature id", e.features[0]);
                if (newHoveredId !== hoveredId) {
                    // Reset state fitur sebelumnya
                    if (hoveredId !== null) {
                        map.setFeatureState(
                            { source: "my-source-id", id: hoveredId },
                            { hover: false }
                        );
                    }

                    hoveredId = newHoveredId;

                    // Set state fitur baru
                    map.setFeatureState(
                        { source: "my-source-id", id: hoveredId },
                        { hover: true }
                    );
                }
            }
        });

        map.on("mouseleave", "geojson-polygon-fill", () => {
            if (hoveredId !== null) {
                map.setFeatureState(
                    { source: "my-source-id", id: hoveredId },
                    { hover: false }
                );
            }
            hoveredId = null;
        });
    }

    const fnRegisterListeners = (map: any) => {
        fnHoverHighlighter(map);
    };

    const MapsProbe = () => {
        const keys = useMap() + "";
        // const map = useMap();
        createEffect(() => {
            const sub = useMap()?.();
            console.log("Use map", sub);
            if (sub) {
                fnRegisterListeners(sub);
            }
        });
        // fnRegisterListeners(map);
        return <Show when={useMap()} fallback={<div>Loading...</div>}>
            <div>Map Ready</div>
        </Show>;
    };

    onMount(() => {
        SJXApiService.svcGetWorldwideGeojson().then(d => {
            console.log("worldwide geojson", d);
            setSigGeojsonWorldWide(d);
        });
    });

    return (
        <Show when={sigGeojsonWorldWide()} fallback={<div>Globeview only valid for Client Rendering</div>}>
            <div class="h-96">
                <Map
                    onload={(map: any) => {
                        console.log("MapLibre, this is not called at all", map);
                        // fnRegisterListeners(map);
                    }}
                    style={{
                        width: "100%",
                        height: "100%",
                        "border-radius": "8px"
                    }}
                    options={{
                        style: noopGlobeStyle,
                        renderWorldCopies: true
                    }}>
                    <NavigationControl options={{ showCompass: true }} />
                    <MapFlyer center={center()} />
                    <MapsProbe />
                    <Source
                        source={{
                            type: "geojson",
                            data: sigGeojsonWorldWide(),
                            promoteId: "ne_id"
                        }}
                    >
                        <Layer
                            onclick={(e) => {console.log(e)}}
                            layer={{
                                id: "geojson-polygon-fill",
                                type: "fill", // Mengubah dari 'circle' ke 'fill'
                                paint: {
                                    "fill-color": "#ff0000",        // Warna merah solid untuk poligon
                                    "fill-opacity": 0.7,            // Membuatnya agak transparan (opsional)
                                    "fill-outline-color": "#ffffff" // Garis tepi putih (setara stroke)
                                },
                            } as any}
                        />

                        <Layer
                            layer={{
                                id: "geojson-polygon-outline",
                                type: "line",
                                paint: {
                                    "line-color": "#ffffff",
                                    "line-width": 1
                                },
                            } as any}
                        />
                    </Source>
                </Map>
            </div>
        </Show>
    )
}