import "./index.css";
import "./../shared/styles/patch-deckgl.css"
import SJXMapblibreGoogleMaps from "~/components/SJXMaplibreGoogleMaps";

export default function PageSolidMaplibreGoogleMaps() {
  
  return (
    <main>
      <h1>Example Mapblibre + Solid Gmaps</h1>
      <SJXMapblibreGoogleMaps></SJXMapblibreGoogleMaps>
    </main>
  );
}
