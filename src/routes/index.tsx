import Counter from "~/components/Counter";
import "./index.css";
import { GoldenLayoutView } from "~/components/GoldenLayoutView";
import { A } from "@solidjs/router";

export default function Home() {

  return (
    <main>
      <h1>Example List</h1>
      <div>
        <a href="/golden-layout">Golden Layout</a>
      </div>
      <div>
        <a href="/svar">SvarGantt {"( mounting React component in SolidJS)"}</a>
      </div>
      <div>
        <a href="/aggrid">Legacy AG Grid</a>
      </div>
      <div>
        <a href="/solid-google-maps">Solid Google Maps (With DeckGL)</a>
      </div>
      <div>
        <a href="/chart-3d">Sample 3D Chart (With Vibes)</a>
      </div>
        <div>
        <a href="/globe-maplibre">Globe Maplibre</a>
      </div>
    </main>
  );  
}
