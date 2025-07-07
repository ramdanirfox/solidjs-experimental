import { Component, JSXElement, createEffect, onCleanup } from "solid-js"

export interface GoogleProps {
    children?: JSXElement;
    gmapref?: any;
    googleref?: any;
    longitude?: any;
    latitude?: any;
}

const SharedGoogleOverlay: Component<GoogleProps> = (props) => {
  let overlayref :any
    const jsx_data = <>
    <div>DONE</div>
    {props.children}
    </>

    createEffect(() => {
          initOverlay();
    });

    onCleanup(()=>{
          if (overlayref) {
            overlayref.toggleDOM(props.gmapref);
            overlayref.setMap(null);
            overlayref = null;
          }
          else {
            console.log('[BBT GIS] Cannot Cleanup. Overlay not initialized yet');
          }
    });

    const initOverlay = () => {
        const bounds = new props.googleref.maps.LatLngBounds(
            new props.googleref.maps.LatLng(props.latitude, props.longitude),
            new props.googleref.maps.LatLng(props.latitude+0.2, props.longitude+0.2)
        );

        const GoogleMapsGLOverlay = buildClassOverlay(props.googleref);

        const overlay = new GoogleMapsGLOverlay(jsx_data, bounds);

        overlayref = overlay

        overlay.setMap(props.gmapref);
    }

    const buildClassOverlay = (google: any) => {
      class GoogleMapsGLOverlay extends google.maps.OverlayView {
        private bounds: google.maps.LatLngBounds;
        private div?: HTMLElement;
        private content: any;
        constructor(content: any, bounds: any) {
            super();
            this.bounds = bounds;
            this.content = content;
        }
    
        onAdd() {
            this.div = document.createElement("div");
            this.div.style.borderStyle = "none";
            this.div.style.borderWidth = "0px";
            this.div.style.position = "absolute";
            this.div.style.pointerEvents = "none";
      
            this.div.appendChild(this.content[1]());
      
            const panes = this.getPanes()!;
      
            // mapPane is the lowest pane and is above the tiles. It may not receive DOM events. (Pane 0).
            // overlayLayer contains polylines, polygons, ground overlays and tile layer overlays. It may not receive DOM events. (Pane 1).
            // markerLayer contains markers. It may not receive DOM events. (Pane 2).
            // overlayMouseTarget contains elements that receive DOM events. (Pane 3).
            // floatPane contains the info window. It is above all map overlays. (Pane 4).

            // panes.overlayLayer.appendChild(this.div);
            panes.overlayMouseTarget.appendChild(this.div);
          }
    
          draw() {
            // We use the south-west and north-east
            // coordinates of the overlay to peg it to the correct position and size.
            // To do this, we need to retrieve the projection from the overlay.
            const overlayProjection = this.getProjection();
      
            // Retrieve the south-west and north-east coordinates of this overlay
            // in LatLngs and convert them to pixel coordinates.
            // We'll use these coordinates to resize the div.
            const sw = overlayProjection.fromLatLngToDivPixel(
              this.bounds.getSouthWest()
            )!;
            const ne = overlayProjection.fromLatLngToDivPixel(
              this.bounds.getNorthEast()
            )!;
      
            // Resize the image's div to fit the indicated dimensions.
            if (this.div) {
              this.div.style.left = sw.x + "0px";
              this.div.style.top = ne.y + "0px";
              this.div.style.width = ne.x - sw.x + "px";
              this.div.style.height = sw.y - ne.y + "px";
              // this.div.style.background = '#fff'
            }
          }
    
           /**
         * The onRemove() method will be called automatically from the API if
         * we ever set the overlay's map property to 'null'.
         */
        onRemove() {
            if (this.div) {
              (this.div.parentNode as HTMLElement).removeChild(this.div);
              delete this.div;
            }
          }
      
          /**
           *  Set the visibility to 'hidden' or 'visible'.
           */
          hide() {
            if (this.div) {
              this.div.style.visibility = "hidden";
            }
          }
      
          show() {
            if (this.div) {
              this.div.style.visibility = "visible";
            }
          }
      
          toggle() {
            if (this.div) {
              if (this.div.style.visibility === "hidden") {
                this.show();
              } else {
                this.hide();
              }
            }
          }
      
          toggleDOM(map: google.maps.Map) {
            if (this.getMap()) {
              this.setMap(null);
            } else {
              this.setMap(map);
            }
          }  
      }
      return GoogleMapsGLOverlay;  
    }


    return <></>;
}

export default SharedGoogleOverlay;