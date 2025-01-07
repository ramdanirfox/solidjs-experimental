declare module 'wx-react-gantt' {
    import * as React from 'react'; 
  
    interface GanttProps {
      // Define the props for the Gantt component here
      tasks: any[]; 
      links: any[];
      scales: any[];
      // ... other props
    }
  
    // const Gantt: React.FC<GanttProps>; 
    const Gantt: any; 
    export default Gantt;
  }