declare module 'ag-grid-solid' {
    // import * as React from 'react'; 
  
    interface GanttProps {
      // Define the props for the Gantt component here
      tasks: any[]; 
      links: any[];
      scales: any[];
      // ... other props
    }
  
    // const ReactSolidBridge: React.FC<GanttProps>; 
    const AgGridSolid: any; 
    export default AgGridSolid;
  }