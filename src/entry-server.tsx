// @refresh reload
import { createHandler, StartServer } from "@solidjs/start/server";

export default createHandler(() => (
  <StartServer
    document={({ assets, children, scripts }) => (
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <link rel="icon" href="/favicon.ico" />
          <script type="text/javascript">
            {`
          //   function fnMuteEventListeners(eventType) {
          //   console.log("[Muting Listener...]")
          //   window.originalEventListener = window.addEventListener; // Store the original event listener
      
          //   // Create a temporary function that does nothing
          //   (window).addEventListener = function(e,f,g) {
          //       if (e != eventType) return (window).originalEventListener(e,f,g);
          //       console.trace("[MUTED!]", e,f,g)
          //   }; 
          
          //   return function() {
          //     // Restore the original event listener
          //     (window).addEventListener = originalEventListener;
          //   };
          // }

          // window.fnUnmuteListener = fnMuteEventListeners("beforeunload");
          `
          }
          </script>
          {assets}
        </head>
        <body>
          <div id="app">{children}</div>
          {scripts}
        </body>
      </html>
    )}
  />
));
