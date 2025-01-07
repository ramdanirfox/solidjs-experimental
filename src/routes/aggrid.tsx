import Counter from "~/components/Counter";
import "./index.css";
import { GoldenLayoutView } from "~/components/GoldenLayoutView";
import SvarReactGantt from "~/shared/components/svar-react-gantt/SvarReactGantt";
import AgGridLegacy from "~/shared/components/aggrid-legacy/AgGridLegacy";

export default function SJXPageAgGridLegacy() {
  
  return (
    <main>
      <h1>AgGrid Legacy!</h1>
      <AgGridLegacy />
    </main>
  );
}
