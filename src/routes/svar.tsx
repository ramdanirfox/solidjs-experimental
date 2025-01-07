import Counter from "~/components/Counter";
import "./index.css";
import { GoldenLayoutView } from "~/components/GoldenLayoutView";
import SvarReactGantt from "~/shared/components/svar-react-gantt/SvarReactGantt";

export default function Home() {
  
  return (
    <main>
      <h1>SVAR!</h1>
      <SvarReactGantt></SvarReactGantt>
    </main>
  );
}
