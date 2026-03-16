import { createSignal, onMount } from "solid-js";
import { SJXApiService } from "~/shared/services/api.service";
import PathFinder, { pathToGeoJSON } from "geojson-path-finder";

export default function SJXGeojsonPathFinder() {
    const [sigGeojson, setSigGeojson] = createSignal<any>();

    onMount(() => {
        console.log("requesting data");
        SJXApiService.svcGetNetworkRouteData().then(d => {
            console.log("received data", d);
            setSigGeojson(d);
        });
    });

    const fnFindPath = () => {
        console.log("find path", sigGeojson());
        const pathFinder = new PathFinder(sigGeojson(), {tolerance: 1e-2});
        const path = pathFinder.findPath(
            // { "type": "Feature", "properties": { "Name": "BU 22.3" }, "geometry": { "type": "Point", "coordinates": [ 132.329279, -3.1020641, 0.0 ] } },
            // { "type": "Feature", "properties": { "Name": "BU 22.2" }, "geometry": { "type": "Point", "coordinates": [ 133.9726437, -4.1057643, 0.0 ] } }
            { "type": "Feature", "properties": { "Name": "BMH MERAUKE" }, "geometry": { "type": "Point", "coordinates": [ 140.3828074, -8.5145866, 0.0 ] } },
            { "type": "Feature", "properties": { "Name": "BMH KAIMANA" }, "geometry": { "type": "Point", "coordinates": [ 133.7424315, -3.6467366, 0.0 ] } }

        );
        console.log("path", path, pathFinder);
        if (path) {
            console.log("pathLineStr", pathToGeoJSON(path));
        }
        // { start: [106.8167, -6.1754], end: [106.8167, -6.1754] }
    }

    return <>
        <button onClick={() => { fnFindPath() }}>Find Path</button>
    </>
}