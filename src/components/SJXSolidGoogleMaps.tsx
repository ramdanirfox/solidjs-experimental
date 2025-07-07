import { createSignal, For, Show } from "solid-js";
import "./Counter.css";
import { APIProvider, Map, MapCameraChangedEvent, useMap } from 'solid-google-maps'
import SharedGoogleOverlay from "~/shared/components/google-maps/maps-gl-overlay";
import SJXGoogleDeckLayer from "./SJXGoogleDeckLayer";

export default function SJXSolidGoogleMaps() {
    const [count, setCount] = createSignal(0);
    const [sigMapZoom, setSigMapZoom] = createSignal(3);
    const [sigGMapRef, setSigGMapRef] = createSignal();
    const [sigGoogleRef, setSigGoogleRef] = createSignal();
    const [sigAPIKey, setSigAPIKey] = createSignal(import.meta.env.VITE_PUBLIC_MAP_KEY);
    const [sigMapID, setSigMapID] = createSignal(import.meta.env.VITE_PUBLIC_MAP_KEY);
    const [sigInputAPIKey, setSigInputAPIKey] = createSignal(import.meta.env.VITE_PUBLIC_MAP_KEY);
    const [sigInputMapID, setSigInputMapID] = createSignal(import.meta.env.VITE_PUBLIC_MAP_KEY);
    const defaultZoom = sigMapZoom();

    const handleApply = () => {
        setSigAPIKey(sigInputAPIKey());
        setSigMapID(sigInputMapID());
    }

    const fnMapReady = (mapRef: any) => {
        setSigGMapRef(mapRef);
        console.log("Map Ready", sigGMapRef());
    }

    const fnGoogleLoad = () => {
        setSigGoogleRef((window as any).google);
        console.log("Google Provider Loaded", sigGoogleRef());
    }

    const fnZoomChanged = (e: MapCameraChangedEvent) => {
        // console.log("Zoom Changed", e);
        setSigMapZoom(e.detail.zoom);
    };

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
                <APIProvider
                    onLoad={fnGoogleLoad}
                    libraries={[ // API Provider is better placed at outer section of your app
                        // 'drawing',
                        // 'geometry',
                        'places',
                        // 'visualization'
                    ]} apiKey={sigAPIKey()}>
                    <Map
                        ref={(mapRef) => fnMapReady(mapRef)}
                        style={{ height: '500px', width: '100%' }}
                        defaultZoom={defaultZoom}
                        defaultCenter={{ lat: 0.54992, lng: 140 }}
                        gestureHandling={'greedy' /* cooperative */}
                        disableDefaultUI={false}
                        tilt={30}
                        mapId={sigMapID()}
                        renderingType="VECTOR"
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
                                    longitude={140+index()}
                                >
                                    <div style={{"pointer-events": "auto"}} onClick={() => alert("Accessed" + index())}>
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
