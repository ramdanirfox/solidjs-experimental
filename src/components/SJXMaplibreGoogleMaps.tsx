import { createSignal, For, onMount, Show } from "solid-js";
import MapGL, { Viewport } from "solid-map-gl";
import * as maplibre from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { googleProtocol, createGoogleStyle } from 'maplibre-google-maps';

// Requires Map Tiles API to be enabled, see following https://mapsplatform.google.com/pricing/

export default function SJXMapblibreGoogleMaps() {
    const [viewport, setViewport] = createSignal({
        center: [-122.41, 37.78],
        zoom: 11,
    } as Viewport);
    onMount(() => {
       maplibre.addProtocol('google', googleProtocol);
    });
        //   options={{
        //             accessToken: MAPBOX_ACCESS_TOKEN,
        //             style: "mb:light",
        //         }}
        // options={{ style: 'https://demotiles.maplibre.org/style.json' }}
    return (
        <div class="tes">
            <MapGL
                style={{ width: "100%", height: "500px" }}
                mapLib={maplibre} // <- Pass MapLibre package here
                options={{ style: createGoogleStyle('google', 'roadmap', import.meta.env.VITE_PUBLIC_MAP_KEY) }}
                viewport={viewport()}
                onViewportChange={(evt: Viewport) => setViewport(evt)}
            ></MapGL>
        </div>
    )
}