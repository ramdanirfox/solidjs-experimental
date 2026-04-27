import { createEffect, createMemo, createSignal, onMount, Show } from "solid-js";
import { Layer, Map, NavigationControl, Source, useMapEffect, useMap } from "solid-maplibre";
import { SJXApiService } from "~/shared/services/api.service";
import "maplibre-gl/dist/maplibre-gl.css";
import mapblibre from "maplibre-gl";
import { GeoJSONFeature } from "maplibre-gl";
import { xfnPolylabel } from "~/shared/utils/polylabel.util";
import SJXUploadJSON from "~/shared/components/upload-json/SJXUploadJSON";
import { xfnInvertMap } from "~/shared/utils/shared.util";

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
    const [sigMapRef, setSigMapRef] = createSignal<mapblibre.Map>();
    const [sigGeojsonWorldWide, setSigGeojsonWorldWide] = createSignal<any>();
    const [sigGeojsonWorldWideCentroid, setSigGeojsonWorldWideCentroid] = createSignal<any>();
    const [sigDictCountryISOA2, setSigDictCountryISOA2] = createSignal<any>();
    const [sigGlyphsProtocolModule, setSigGlyphsProtocolModule] = createSignal<any>();
    const [hoveredId, setHoveredId] = createSignal<string | number | null>(null);

    const noopGlobeStyle = {
        version: 8 as 8,
        sources: {},
        glyphs: "glyphs://{fontstack}/{range}",
        projection: {
            type: "globe"
        },
        'sky': {
            "sky-color": "#403d36",
            "sky-horizon-blend": 0.5,
            "horizon-color": "#cc009c",
            "horizon-fog-blend": 0.5,
            "fog-color": "#ff0000",
            "fog-ground-blend": 0.5,
            // 'atmosphere-blend': [
            //     'interpolate',
            //     ['linear'],
            //     ['zoom'],
            //     0, 1,
            //     5, 1,
            //     7, 1
            // ]
        },
        layers: [
            {
                id: "background",
                type: "background",
                paint: {
                    "background-color": "#6bbcff" // Warna laut gelap agar atmosfer terlihat bagus
                }
            }
        ]
    } as any;

    const fnLayerMouseMove = (e: any) => {
        if (e.features && e.features.length > 0) {
            console.log("mousemove", e.features);
            const newId = e.features[0].id;
            const prev = hoveredId();
            if (prev !== newId) {
                const map = e.target;
                if (prev) {
                    map.setFeatureState(
                        { source: "worldwide_lite_geo.json", id: prev },
                        { hover: false }
                    );
                }

                // Set yang baru
                setHoveredId(newId);
                map.setFeatureState(
                    { source: "worldwide_lite_geo.json", id: newId },
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
                { source: "worldwide_lite_geo.json", id: oldId },
                { hover: false }
            );
            setHoveredId(null);
        }
    }

    const fnRegisterAnimator = (map: any) => {
        console.log("registering animation...", map);
        const secondsPerRevolution = 120;
        const maxRollOver = 360;
        const framesPerSecond = 60;

        let isInteracting = false;

        map.on('mouseover', (e: any) => {
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

    const fnRegisterLocalGlyphsProtocol = (map: any) => {
        import("maplibre-local-glyphs" as any).then(m => {
            console.log("Glyphs Module", m);
            mapblibre.addProtocol("glyphs", m.default);
            setSigGlyphsProtocolModule(m);
        });
    }

    const fnUpdateText = () => {
        const labelLookup = ["match", ["get", "ISO"]];
        const dict = xfnInvertMap(sigDictCountryISOA2());
        sigGeojsonWorldWideCentroid().features.forEach((f: any) => {
            const p = f.properties;
            const pid = p.ISO;
            if (dict[pid] && labelLookup.indexOf(dict[pid]) === -1) {
                labelLookup.push(pid, dict[pid]);
            }
        });
        labelLookup.push(["get", "ISO"]);
        console.log("Lookup", labelLookup);
        sigMapRef()?.setLayoutProperty('geojson-text-country', 'text-field', labelLookup);
    }

    const fnDictionary = (d: any) => {
        console.log("Dict", d);
        setSigDictCountryISOA2(d);
        fnUpdateText();
    }

    const fnValues = () => {

    }

    const MapsProbe = () => {
        const keys = useMap() + "";
        // const map = useMap();
        createEffect(() => {
            const sub = useMap()?.();
            console.log("Use map", sub);
            if (sub) {
                setSigMapRef(sub);
                // fnRegisterListeners(sub);
                fnRegisterAnimator(sub);
                fnRegisterLocalGlyphsProtocol(sub);
            }
        });
        // fnRegisterListeners(map);
        return <Show when={useMap()} fallback={<div>Loading...</div>}>
            <div>Map Ready</div>
        </Show>;
    };

    onMount(() => {
        const labelGeoJSON = {
            type: "FeatureCollection",
            features: [] as any
        };
        SJXApiService.svcGetWorldwideCentroid().then((d: any) => {
            console.log("worldwide centroid", d);
            setSigGeojsonWorldWideCentroid(d);
        });
        SJXApiService.svcGetWorldwideGeojson().then((d: any) => {
            console.log("worldwide geojson", d);
            // d.features.forEach((f: GeoJSONFeature, i: number) => {
            //     const coord = (f.geometry as any).coordinates;
            //     const polylabelRes = xfnPolylabel(coord, 0.000001, false);
            //     if (isNaN(polylabelRes[0])) {
            //         console.log("failure at polylab", f.properties.ne_id, f.properties.name_en, i, polylabelRes);
            //     }
            //     else {
            //         labelGeoJSON.features.push({
            //             "type": "Feature",
            //             "geometry": {
            //                 "type": "Point",
            //                 "coordinates": polylabelRes
            //             },
            //             "properties": f.properties
            //         });
            //         console.log("polylabel", f.properties.ne_id, f.properties.name_en, i, polylabelRes, labelGeoJSON);
            //     }
            // });
            setSigGeojsonWorldWide(d);
        });
    });

    return (
        <Show when={
            sigGeojsonWorldWide() &&
            sigGeojsonWorldWideCentroid()} fallback={<div>Globeview only valid for Client Rendering</div>}>
            <div class="h-96">
                <div class="flex justify-center">
                    <SJXUploadJSON label="Upload Dictionary" onUpload={fnDictionary}></SJXUploadJSON>
                    <SJXUploadJSON label="Upload Map of Values" onUpload={fnDictionary}></SJXUploadJSON>
                </div>
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
                        renderWorldCopies: true,
                        ...{
                            localFontFamily: 'sans-serif'
                        } as any
                    }}>
                    <NavigationControl options={{ showCompass: true }} />
                    <MapFlyer center={center()} />
                    <MapsProbe />
                    <Source
                        id="worldwide_lite_geo.json"
                        source={{
                            type: "geojson",
                            data: sigGeojsonWorldWide(),
                            promoteId: "iso_a2"
                        }}
                    >
                        <Layer
                            onclick={(e) => { console.log(e); alert("Clicked on " + e.features?.[0].properties?.name_en); }}
                            onmousemove={(e) => { fnLayerMouseMove(e); }}
                            onmouseout={(e) => { console.log("mouseout", e); fnLayerMouseOut(e); }}
                            id="geojson-polygon-fill"
                            layer={{
                                type: "fill",
                                paint: {
                                    // Menggunakan ekspresi 'case' untuk mengecek state 'hover'
                                    "fill-color": [
                                        "case",
                                        ["boolean", ["feature-state", "hover"], false],
                                        "#ffff00", // Warna Kuning saat kursor di atasnya (Highlight)
                                        "#2fca58"  // Warna Merah default
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
                            id="geojson-polygon-outline"
                            layer={{
                                type: "line",
                                paint: {
                                    "line-color": "#ffffff",
                                    "line-width": 1
                                },
                            } as any}
                        />
                    </Source>
                    <Source
                        id="world_countries_centroids.json"
                        source={{
                            type: "geojson",
                            data: sigGeojsonWorldWideCentroid(),
                            promoteId: "ISO"
                        }}
                    >
                        <Layer
                            id="geojson-text-country"
                            layer={{
                                type: "symbol",
                                "layout": {
                                    "text-font": ["sans-serif"],
                                    "text-size": 20,
                                    "text-field": ["get", "ISO"],
                                    "text-justify": "center",
                                    "text-anchor": "center"
                                },
                                "paint": {
                                    "text-color": "white",
                                    "text-halo-color": "rgba(0, 0, 0, 0.8)",
                                    "text-halo-width": 1,
                                    "text-halo-blur": 0
                                }
                            } as any}
                        />
                    </Source>
                </Map>
            </div>
        </Show>
    )
}