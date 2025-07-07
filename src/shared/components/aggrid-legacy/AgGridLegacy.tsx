// import AgGridSolid from "ag-grid-solid";

import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-alpine.css";
import { createSignal, onMount, Show } from "solid-js";
// import AgGridSolid from "solid-ag-grid";
import Aggrid from "solid-ag-grid";

export default function AgGridLegacy() {
    let [sigAgGrid, setSigAgGrid] = createSignal<any>(null);
    let AgGridSolid: any;
    onMount(() => {
        import("ag-grid-solid").then(mod => {
            AgGridSolid = mod.default;
            setSigAgGrid(mod);
            console.log("Ref Aggrid", mod);
        });
    });

    const columnDefs: any = [
        { field: 'make' },
        { field: 'model' },
        { field: 'price' },
    ];
    const rowData = [
        { make: 'Toyota', model: 'Celica', price: 35000 },
        { make: 'Ford', model: 'Mondeo', price: 32000 },
        { make: 'Porsche', model: 'Boxster', price: 72000 },
    ];
    const defaultColDef = {
        flex: 1,
    };
    return (
        // <Show when={sigAgGrid()} fallback={"Loading..."}>
            <div class="ag-theme-alpine" style={{ height: '100vh' }}>
                <Aggrid
                    columnDefs={columnDefs}
                    rowData={rowData}
                    defaultColDef={defaultColDef}
                />
            </div>
        // </Show>
    );
}
