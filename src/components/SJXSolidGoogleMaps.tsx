import { createSignal, For, onMount, Show } from "solid-js";
import "./Counter.css";
import { APIProvider, Map, MapCameraChangedEvent, useMap } from 'solid-google-maps'
import SharedGoogleOverlay from "~/shared/components/google-maps/maps-gl-overlay";
import SJXGoogleDeckLayer from "./SJXGoogleDeckLayer";
import { Easing, Group, Tween, update } from "@tweenjs/tween.js";

export default function SJXSolidGoogleMaps() {
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

    const fnFlyTo = (targetpos: { lng: number, lat: number, zoom: number }) => {
        const map = sigGMapRef() as unknown as google.maps.Map;
        const pos = map.getCenter();
        const cameraOptions: google.maps.CameraOptions = {
            tilt: map.getTilt(),
            heading: map.getHeading(),
            zoom: map.getZoom(),
            center: { lat: pos?.lat() || 0, lng: pos?.lng() || 0 },
        };

        const time = 3000;
        const halfTime = time / 2;

        // Initial and target camera options
        const startCamera = {
            tilt: cameraOptions.tilt,
            heading: cameraOptions.heading,
            zoom: cameraOptions.zoom,
            center: { ...cameraOptions.center }
        };
        const targetCamera = {
            tilt: 0,
            heading: 0,
            zoom: targetpos.zoom,
            center: { lat: targetpos.lat, lng: targetpos.lng }
        };

        // Tween 1: animate center in half the time
        const centerObj = { ...startCamera.center };
        const tweenCenter = new Tween(centerObj)
            .to(targetCamera.center, halfTime)
            .easing(Easing.Quintic.Out)
            .onUpdate(() => {
                map.moveCamera({ center: { ...centerObj } as any });
            });

        // Tween 2: animate tilt, heading, zoom in full time
        const otherObj = {
            tilt: startCamera.tilt,
            heading: startCamera.heading,
            zoom: startCamera.zoom
        };
        const tweenOther = new Tween(otherObj)
            .to({
                tilt: targetCamera.tilt,
                heading: targetCamera.heading,
                zoom: targetCamera.zoom
            }, time)
            .easing(Easing.Cubic.Out)
            .onUpdate(() => {
                map.moveCamera({ ...otherObj });
            });

        // Group both tweens
        const group = new Group();
        group.add(tweenCenter);
        group.add(tweenOther);

        tweenCenter.start();
        tweenOther.start();

        function animate(time: number) {
            requestAnimationFrame(animate);
            // tweenCenter.update(time);
            // tweenOther.update(time);
            group.update(time);
        }

        requestAnimationFrame(animate);
    }

    /**
     * Fly to bounds with animation.
     * @param bbox [[lng1, lat1], [lng2, lat2]]
     * @param cameraOption Optional camera options: { tilt, heading, zoom }
     */
    const fnFlyToBounds = (
        bbox: [[number, number], [number, number]],
        cameraOption?: { tilt?: number; heading?: number; padding?: number }
    ) => {
        const map = sigGMapRef() as unknown as google.maps.Map;
        const googleRef: any = sigGoogleRef();
        if (!map || !googleRef || !bbox || bbox.length !== 2) return;

        // Calculate bounds
        const [lng1, lat1] = bbox[0];
        const [lng2, lat2] = bbox[1];
        const sw = { lat: Math.min(lat1, lat2), lng: Math.min(lng1, lng2) };
        const ne = { lat: Math.max(lat1, lat2), lng: Math.max(lng1, lng2) };
        const bounds = new googleRef.maps.LatLngBounds(sw, ne);

        // Calculate center
        const center = bounds.getCenter().toJSON();

        // Estimate zoom to fit bounds (simple heuristic, not perfect)
        // You may want to improve this with a more accurate calculation
        const WORLD_DIM = { height: 256, width: 256 };
        const ZOOM_MAX = 21;

        function latRad(lat: number) {
            const sin = Math.sin(lat * Math.PI / 180);
            const radX2 = Math.log((1 + sin) / (1 - sin)) / 2;
            return Math.max(Math.min(radX2, Math.PI), -Math.PI) / 2;
        }

        function getBoundsZoom(bounds: any, mapDim: { height: number, width: number }, padding: number) {
            const ne = bounds.getNorthEast();
            const sw = bounds.getSouthWest();

            const latFraction = (latRad(ne.lat()) - latRad(sw.lat())) / Math.PI;
            const lngDiff = ne.lng() - sw.lng();
            const lngFraction = ((lngDiff < 0) ? (lngDiff + 360) : lngDiff) / 360;

            const latZoom = Math.log(mapDim.height / padding / WORLD_DIM.height / latFraction) / Math.LN2;
            const lngZoom = Math.log(mapDim.width / padding / WORLD_DIM.width / lngFraction) / Math.LN2;

            return Math.min(latZoom, lngZoom, ZOOM_MAX);
        }

        const padding = cameraOption?.padding ?? 50;
        const mapDiv = map.getDiv();
        const mapDim = {
            width: mapDiv.offsetWidth || 800,
            height: mapDiv.offsetHeight || 600
        };
        const fitZoom = getBoundsZoom(bounds, mapDim, padding);

        // Animate camera to bounds
        const cameraOptions: google.maps.CameraOptions = {
            tilt: cameraOption?.tilt ?? map.getTilt(),
            heading: cameraOption?.heading ?? map.getHeading(),
            zoom: fitZoom,
            center
        };

        const twInstance = new Tween({
            tilt: map.getTilt(),
            heading: map.getHeading(),
            zoom: map.getZoom(),
            center: map.getCenter()?.toJSON()
        })
            .to(cameraOptions, 15000)
            .easing(Easing.Quadratic.Out)
            .onUpdate((current) => {
                map.moveCamera(current);
            })
            .start();

        function animate(time: number) {
            requestAnimationFrame(animate);
            twInstance.update(time);
        }

        requestAnimationFrame(animate);
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

    const fnRecursivelyExtendCoordinate = () => {

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

    const fnFlyToArc = () => {

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
                <button onClick={() => fnFlyToBounds([[106.81548037914058, -6.301188823396288], [106.82820078053862, -6.318298021062958]], { padding: 1 })}>flyToBboxTween</button>
                <button onClick={() => fnPanToBounds([[106.81548037914058, -6.301188823396288], [106.82820078053862, -6.318298021062958]])}>panToBounds</button>
                <APIProvider
                    onLoad={fnGoogleLoad}
                    libraries={[ // API Provider is better placed at outer section of your app
                        // 'drawing',
                        // 'geometry',
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
