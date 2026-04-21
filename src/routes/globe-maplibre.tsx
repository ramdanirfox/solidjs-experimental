import "./index.css";
import "./../shared/styles/patch-deckgl.css"
import SJX3dchart from "~/components/SJX3dchart";
import SJXGlobeMaplibre from "~/components/SJXGlobeMaplibre";
import { clientOnly } from "@solidjs/start";

const SJXClientGlobeMaplibre = clientOnly(() => import("./../components/SJXGlobeMaplibre"));

export default function PageSolidGlobeMaplibre() {
  return (
    <main>
      <h1>Globe Maplibre</h1>
     <SJXClientGlobeMaplibre></SJXClientGlobeMaplibre>
    </main>
  );
}
