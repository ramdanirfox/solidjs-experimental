Current implementation info

Uncompressed <mxGraphModel>: this should load. The import uses maxGraph's own ModelXmlSerializer, which reads standard mxGraph XML, and basic shapes and edge styles such as rounded=1;fillColor=… and edgeStyle=orthogonalEdgeStyle map across.
A normal .drawio / .mxfile: this fails. Those files wrap the model in <mxfile><diagram>…, and the content is usually deflate+base64 compressed by default. I don't unwrap or decompress either. The file picker accepts .drawio, but nothing handles it.
A failed import wipes the open diagram: setXml clears the model before importing, so a parse error leaves an empty canvas. I should fix this by parsing first, or rolling back on error.
Visual gaps:
Labels from draw.io use html=1, but I render plain-text labels, so you'd see raw <b>/<br> tags.
draw.io-specific shapes (AWS, cylinder3, and similar) need stencils registered and will fall back to rectangles.
Exporting to draw.io

getXml() writes maxGraph's native <GraphDataModel> format, with _x/_y geometry attributes. draw.io won't open that.
Node types are stored as named styles (style="start"). draw.io has no such styles, so those nodes would render as plain default boxes even if the structure loaded. To avoid that, export would need to inline the resolved style into each cell.

<mxfile> import: pick a diagram page, and decompress with the browser's built-in DecompressionStream.
A safe import that keeps the current diagram if parsing fails.
A draw.io export (exportDrawio(), plus an "Ekspor… → draw.io" option). It would write an <mxGraphModel> with styles flattened into style strings.
Optionally, HTML labels, which come with a trade-off. The labels would render correctly, but imported XML could inject markup, so I'd sanitize them.