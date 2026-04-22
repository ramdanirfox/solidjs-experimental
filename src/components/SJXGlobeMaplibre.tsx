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
    const [hoveredId, setHoveredId] = createSignal<string | number | null>(null);
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

      const fnLayerMouseMove = (e: any) => {
        if (e.features && e.features.length > 0) {
            console.log("mousemove", e.features);
            const newId = e.features[0].id;
            const prev = hoveredId();

            // Hanya eksekusi logika jika kita pindah ke poligon yang berbeda
            if (prev !== newId) {
            const map = e.target;

            // Bersihkan yang lama (jika ada)
            if (prev) {
                map.setFeatureState(
                { source: "my-source-id", id: prev },
                { hover: false }
                );
            }

            // Set yang baru
            setHoveredId(newId);
            map.setFeatureState(
                { source: "my-source-id", id: newId },
                { hover: true }
            );
            }
        }
    };

   const fnLayerMouseOut = (e: any) => {
     const oldId = hoveredId();
    if (oldId !== null) {
      const map = e.target;
      map.setFeatureState(
        { source: "my-source-id", id: oldId },
        { hover: false }
      );
      setHoveredId(null);
    }
   }


    const fnRegisterListeners = (map: any) => {
        // fnHoverHighlighter(map);
    };

    const fnRegisterAnimator = (map: any) => {  
        console.log("registering animation...", map);
        const secondsPerRevolution = 120;
        const maxRollOver = 360;
        const framesPerSecond = 60;

        let isInteracting = false;

        // Bergerak karena user (drag, zoom, tilt)

        map.on('mouseover', (e) => {
            if (e.originalEvent) isInteracting = true;
        });

        // Berhenti total (termasuk setelah inertia selesai)
        map.on('mouseout', () => {
            isInteracting = false;
        });


        const animate = () => {
            // PERBAIKAN: Cek apakah user sedang berinteraksi
            // isMoving() menangkap drag, zoom, rotate, dan tilt manual
            const isUserInteracting = map.isMoving() || map.isZooming() || map.isRotating() || isInteracting;

            if (!isUserInteracting) {
                const center = map.getCenter();
                center.lng += (360 / secondsPerRevolution) / framesPerSecond;
                
                if (center.lng >= maxRollOver) center.lng -= 360;
                
                // Gunakan jumpTo agar lebih ringan daripada setCenter untuk animasi frame-by-frame
                map.jumpTo({ center: center });
            }
            
            requestAnimationFrame(animate);
        };

        animate();
    }

    const MapsProbe = () => {
        const keys = useMap() + "";
        // const map = useMap();
        createEffect(() => {
            const sub = useMap()?.();
            console.log("Use map", sub);
            if (sub) {
                // fnRegisterListeners(sub);
                fnRegisterAnimator(sub);
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
                        id="my-source-id"
                        source={{
                            type: "geojson",
                            data: sigGeojsonWorldWide(),
                            promoteId: "ne_id"
                        }}
                    >
                        <Layer
                            onclick={(e) => {console.log(e); alert("Clicked on " + e.features?.[0].properties?.name_en);}}
                            onmousemove={(e) => {fnLayerMouseMove(e);}}
                            onmouseout={(e) => {console.log("mouseout", e); fnLayerMouseOut(e);}}
                            layer={{
                                id: "geojson-polygon-fill",
                                type: "fill",
                                paint: {
                                    // Menggunakan ekspresi 'case' untuk mengecek state 'hover'
                                    "fill-color": [
                                        "case",
                                        ["boolean", ["feature-state", "hover"], false],
                                        "#ffff00", // Warna Kuning saat kursor di atasnya (Highlight)
                                        "#ff0000"  // Warna Merah default
                                    ],
                                    "fill-opacity": [
                                        "case",
                                        ["boolean", ["feature-state", "hover"], false],
                                        1,   // Full terang saat hover
                                        0.7  // Semi-transparan saat normal
                                    ],
                                    "fill-outline-color": "#ffffff"
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