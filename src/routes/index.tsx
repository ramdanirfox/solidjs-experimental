import Counter from "~/components/Counter";
import "./index.css";
import { GoldenLayoutView } from "~/components/GoldenLayoutView";
import { A } from "@solidjs/router";

export default function Home() {

  return (
    <main>
      <h1>Example List</h1>
      <div>
        <A href="/golden-layout">Golden Layout</A>
      </div>
      <div>
        <A href="/svar">SvarGantt {"( mounting React component in SolidJS)"}</A>
      </div>
      <div>
        <A href="/aggrid">Legacy AG Grid</A>
      </div>
      <div>
        <A href="/solid-google-maps">Solid Google Maps (With DeckGL)</A>
      </div>
    </main>
  );  
}
