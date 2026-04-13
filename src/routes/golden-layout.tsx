import Counter from "~/components/Counter";
import "./index.css";
import { GoldenLayoutView } from "~/components/GoldenLayoutView";
import { GoldenLayoutView2 } from "~/components/GoldenLayoutView2";

export default function PageGoldenLayout() {
  
  return (
    <main>
      <h1>Example Golden Layout</h1>
      <Counter />
      {/* <GoldenLayoutView></GoldenLayoutView> */}
      <GoldenLayoutView2></GoldenLayoutView2>
    </main>
  );
}
