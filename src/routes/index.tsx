import Counter from "~/components/Counter";
import "./index.css";
import { GoldenLayoutView } from "~/components/GoldenLayoutView";
import { A } from "@solidjs/router";
import { APP_DEV_BASEURL } from "~/shared/constants/app.constant";

export default function Home() {
  const BASEURL = APP_DEV_BASEURL;
  return (
    <main>
      <h1>Example List</h1>
      <div>
        <a href={`${BASEURL}/golden-layout`}>Golden Layout</a>
      </div>
      <div>
        <a href={`${BASEURL}/svar`}>SvarGantt {"( mounting React component in SolidJS)"}</a>
      </div>
      <div>
        <a href={`${BASEURL}/aggrid`}>Legacy AG Grid</a>
      </div>
      <div>
        <a href={`${BASEURL}/solid-google-maps`}>Solid Google Maps (With DeckGL)</a>
      </div>
      <div>
        <a href={`${BASEURL}/chart-3d`}>Sample 3D Chart (With Vibes)</a>
      </div>
      <div>
        <a href={`${BASEURL}/globe-maplibre`}>Globe Maplibre</a>
      </div>
    </main>
  );  
}
