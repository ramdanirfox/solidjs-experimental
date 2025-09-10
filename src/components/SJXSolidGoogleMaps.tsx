import { createSignal, For, onMount, Show } from "solid-js";
import "./Counter.css";
import { APIProvider, Map, MapCameraChangedEvent, useMap } from 'solid-google-maps'
import SharedGoogleOverlay from "~/shared/components/google-maps/maps-gl-overlay";
import SJXGoogleDeckLayer from "./SJXGoogleDeckLayer";
import { Easing, Group, Tween, update } from "@tweenjs/tween.js";
import { GMapCameraFlyToAPI, GMapCameraService, GMapCameraServiceFactory } from "~/shared/services/gmap-camera.service";

export default function SJXSolidGoogleMaps() {
    const [sigMapZoom, setSigMapZoom] = createSignal(3);
    const [sigGMapRef, setSigGMapRef] = createSignal();
    const [sigGoogleRef, setSigGoogleRef] = createSignal();
    const [sigAPIKey, setSigAPIKey] = createSignal(import.meta.env.VITE_PUBLIC_MAP_KEY);
    const [sigMapID, setSigMapID] = createSignal(import.meta.env.VITE_PUBLIC_MAP_KEY);
    const [sigInputAPIKey, setSigInputAPIKey] = createSignal(import.meta.env.VITE_PUBLIC_MAP_KEY);
    const [sigInputMapID, setSigInputMapID] = createSignal(import.meta.env.VITE_PUBLIC_MAP_KEY);
    const defaultZoom = sigMapZoom();
    let gmapCameraService: GMapCameraService;
    let gmapCameraFlyToApi: GMapCameraFlyToAPI;

    const handleApply = () => {
        setSigAPIKey(sigInputAPIKey());
        setSigMapID(sigInputMapID());
    }

    const fnAttemptRegisterCameraService = () => {
        const gmapref = sigGMapRef();
        const googleref = sigGoogleRef();
        if (gmapref && googleref) {
            gmapCameraService = GMapCameraServiceFactory(googleref, gmapref);
        }
    }

    const fnMapReady = (mapRef: any) => {
        setSigGMapRef(mapRef);
        console.log("Map Ready", sigGMapRef());
        fnAttemptRegisterCameraService();
    }

    const fnGoogleLoad = () => {
        setSigGoogleRef((window as any).google);
        console.log("Google Provider Loaded", sigGoogleRef());
        fnAttemptRegisterCameraService();
    }

    const fnZoomChanged = (e: MapCameraChangedEvent) => {
        // console.log("Zoom Changed", e);
        setSigMapZoom(e.detail.zoom);
    };

    const fnFlyTo = (targetpos: { lng: number, lat: number, zoom: number, duration?: number }) => {
       gmapCameraFlyToApi = gmapCameraService.fnFlyTo(targetpos);
    }

    const fnFlyToBounds = (
        bbox: [[number, number], [number, number]],
        cameraOption?: { tilt?: number; heading?: number; padding?: number, useFlyTo?: boolean }
    ) => {
        console.log("With new flyTo service :)");
        gmapCameraFlyToApi = gmapCameraService.fnFlyToBounds(bbox, cameraOption);
    }

    const fnPanToBounds = (bounds: [number, number][]) => {
        const latLngBounds = new google.maps.LatLngBounds(
            new google.maps.LatLng(bounds[0][1], bounds[0][0]),
            new google.maps.LatLng(bounds[1][1], bounds[1][0])
        );

        const map = sigGMapRef() as unknown as google.maps.Map;

        map.panToBounds(latLngBounds, {
            // easing,
            // duration
        });
    }

    const fnGeoJSONToBounds = (geojson: any) => {
        const latLngBounds = new google.maps.LatLngBounds();
        geojson.features.forEach((feature: any) => {
            const coordinates = feature.geometry.coordinates;
            const extendCoordinates = (coords: any) => {
                if (typeof coords[0] === "number" && typeof coords[1] === "number") {
                    latLngBounds.extend(new google.maps.LatLng(coords[1], coords[0]));
                } else if (Array.isArray(coords)) {
                    coords.forEach(extendCoordinates);
                }
            };

            extendCoordinates(coordinates);
        });
        return latLngBounds;
    }


    const fnOnDrag = () => {
        console.log("User attempt to drag");
    }

    onMount(() => {
        console.log("Function panToBounds", fnPanToBounds);
        console.log("Function fnGeoJSONToBounds", fnGeoJSONToBounds);
    })

    return (
        <div>
            <Show when={!sigAPIKey()}>
                <div>
                    API Key : <input placeholder="API Key" onChange={(e) => setSigInputAPIKey(e.target.value)}></input>
                    Map ID : <input placeholder="Map ID" onChange={(e) => setSigInputMapID(e.target.value)}></input>
                    <button type="submit" onClick={handleApply}>Apply</button>
                </div>
            </Show>
            <Show when={sigAPIKey()}>
                <button onClick={() => fnFlyTo({ lat: -6.309615123970005, lng: 106.82188445078322, zoom: 15 })}>flyToTween</button>
                <button onClick={() => fnFlyToBounds([[106.81548037914058, -6.301188823396288], [106.82820078053862, -6.318298021062958]], { padding: 1, useFlyTo: true })}>flyToBboxTween</button>
                <button onClick={() => fnFlyToBounds([[140.34466715682066, -2.394364723691936], [140.73294259110833, -2.6180471200476774]], { padding: 1, useFlyTo: true })}>flyToBboxTweenJayapura</button>
                <button onClick={() => fnPanToBounds([[106.81548037914058, -6.301188823396288], [106.82820078053862, -6.318298021062958]])}>panToBounds</button>
                <APIProvider
                    onLoad={fnGoogleLoad}
                    libraries={[ // API Provider is better placed at outer section of your app
                        // 'drawing',
                        'geometry',
                        'places',
                        // 'visualization'
                    ]} apiKey={sigAPIKey()}>
                    {/* defaultZoom={defaultZoom}
                        defaultCenter={{ lat: 0.54992, lng: 140 }}
                        tilt={30} */}
                    <Map
                        ref={(mapRef) => fnMapReady(mapRef)}
                        style={{ height: '500px', width: '100%' }}
                        gestureHandling={'greedy' /* cooperative */}
                        disableDoubleClickZoom={true}
                        disableDefaultUI={true}
                        defaultBounds={{
                            north: -11.5,
                            south: 11.5,
                            east: 141.5,
                            west: 95
                        }}
                        mapId={sigMapID()}
                        renderingType="VECTOR"
                        onDrag={fnOnDrag}
                        onZoomChanged={fnZoomChanged}
                    >
                        {/* <AdvancedMarker
                            clickable={true}
                            position={{ lat: 0.24992, lng: 140 }}
                            >
                                <div style={{"background-color": 'red'}}>
                                    Hallo Dunia
                                </div>
                        </AdvancedMarker> */}
                    </Map>
                    <Show when={sigGMapRef() && sigGoogleRef()}>
                        <For each={[0.25, 0.5, 0.75]}
                        >
                            {(lt, index) => (
                                <SharedGoogleOverlay
                                    gmapref={sigGMapRef()}
                                    googleref={sigGoogleRef()}
                                    latitude={lt}
                                    longitude={140 + index()}
                                >
                                    <div style={{ "pointer-events": "auto" }} onClick={() => alert("Accessed" + index())}>
                                        <div style={{ "background-color": "#FFFA" }}>
                                            Halo Dunia
                                        </div>
                                    </div>
                                </SharedGoogleOverlay>
                            )}
                        </For>
                        <SJXGoogleDeckLayer
                            sigZoom={sigMapZoom}
                            gmapref={sigGMapRef()}
                            onReady={() => { }}
                        />
                    </Show>
                </APIProvider>
            </Show>
        </div>
    );
}
