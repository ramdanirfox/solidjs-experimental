import Counter from "~/components/Counter";
import "./index.css";
import { GoldenLayoutView } from "~/components/GoldenLayoutView";

export default function PageGoldenLayout() {
  
  return (
    <main>
      <h1>Example Golden Layout</h1>
      <Counter />
      <GoldenLayoutView></GoldenLayoutView>
    </main>
  );
}
