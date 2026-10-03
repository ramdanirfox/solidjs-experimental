import { clientOnly } from "@solidjs/start";
import { Title } from "@solidjs/meta";
import { createSignal } from "solid-js";
import type { MaxgraphEdgeStyle, MaxgraphNodeEditorApi } from "~/shared/components/maxgraph-editor/types";

// Render hanya di sisi client: maxGraph memakai DOM, SVG, dan Drag & Drop API.
const SJXClientMaxgraphEditor = clientOnly(() => import("./../components/SJXMaxgraphEditor"));

const SAMPLE_XML = `<mxGraphModel><root>
  <mxCell id="0"/><mxCell id="1" parent="0"/>
  <mxCell id="a" value="Start" style="start" vertex="1" parent="1"><mxGeometry x="40" y="80" width="140" height="44" as="geometry"/></mxCell>
  <mxCell id="b" value="Trigger Event" style="trigger" vertex="1" parent="1"><mxGeometry x="240" y="80" width="140" height="44" as="geometry"/></mxCell>
  <mxCell id="c" value="Condition" style="condition" vertex="1" parent="1"><mxGeometry x="440" y="80" width="140" height="44" as="geometry"/></mxCell>
  <mxCell id="d" value="SQL Query" style="sql" vertex="1" parent="1"><mxGeometry x="640" y="20" width="140" height="44" as="geometry"/></mxCell>
  <mxCell id="e" value="End" style="end" vertex="1" parent="1"><mxGeometry x="640" y="140" width="140" height="44" as="geometry"/></mxCell>
  <mxCell id="e1" edge="1" source="a" target="b" parent="1"><mxGeometry relative="1" as="geometry"/></mxCell>
  <mxCell id="e2" edge="1" source="b" target="c" parent="1"><mxGeometry relative="1" as="geometry"/></mxCell>
  <mxCell id="e3" value="ya" edge="1" source="c" target="d" parent="1"><mxGeometry relative="1" as="geometry"/></mxCell>
  <mxCell id="e4" value="tidak" edge="1" source="c" target="e" parent="1"><mxGeometry relative="1" as="geometry"/></mxCell>
</root></mxGraphModel>`;

export default function PageMaxgraphEditor() {
  const [readonly, setReadonly] = createSignal(false);
  const [grid, setGrid] = createSignal(true);
  const [outline, setOutline] = createSignal(false);
  const [edgeStyle, setEdgeStyle] = createSignal<MaxgraphEdgeStyle>("orthogonal");
  const [xml, setXml] = createSignal(SAMPLE_XML);
  const [info, setInfo] = createSignal("");
  let api: MaxgraphNodeEditorApi | undefined;
  let resets = 0;

  const sel = { padding: "2px 6px", border: "1px solid #cbd5e1", "border-radius": "6px" } as const;
  return (
    <div class="sjx-page sjx-page-fill">
      <Title>Maxgraph Node Editor</Title>
      <div class="sjx-page-head">
        <div>
          <div class="sjx-page-title">Maxgraph Node Editor</div>
          <div class="sjx-page-sub">
            Editor diagram node dengan <code>@maxgraph/core</code> — seret node dari palet, sambung dengan menarik ikon biru, klik kanan untuk menu, undo/redo, tata letak otomatis, impor/ekspor XML, SVG, PNG.
          </div>
        </div>
        <div style={{ display: "flex", gap: "14px", "align-items": "center", "flex-wrap": "wrap" }}>
          <label class="sjx-switch"><input type="checkbox" checked={readonly()} onChange={e => setReadonly(e.currentTarget.checked)} /><span>Baca-saja <code>readonly</code></span></label>
          <label class="sjx-switch"><input type="checkbox" checked={grid()} onChange={e => setGrid(e.currentTarget.checked)} /><span>Grid <code>grid</code></span></label>
          <label class="sjx-switch"><input type="checkbox" checked={outline()} onChange={e => setOutline(e.currentTarget.checked)} /><span>Minimap <code>outline</code></span></label>
          <label class="sjx-switch">
            <span>Garis <code>edgeStyle</code></span>
            <select value={edgeStyle()} onChange={e => setEdgeStyle(e.currentTarget.value as MaxgraphEdgeStyle)} style={sel}>
              <option value="orthogonal">orthogonal</option><option value="straight">straight</option><option value="curved">curved</option><option value="elbow">elbow</option><option value="entity">entity</option>
            </select>
          </label>
          <button type="button" style={sel} onClick={() => setXml(SAMPLE_XML + " ".repeat(++resets))}>Reset contoh</button>
        </div>
      </div>
      <div style={{ flex: "1", "min-height": "420px", display: "flex", "flex-direction": "column", gap: "8px" }}>
        <div style={{ flex: "1", "min-height": "0" }}>
          <SJXClientMaxgraphEditor
            height="100%"
            xml={xml()}
            readonly={readonly()}
            grid={grid()}
            outline={outline()}
            edgeStyle={edgeStyle()}
            onReady={a => (api = a)}
            onChange={x => setInfo(`onChange: ${x.length} karakter XML`)}
            onSelectionChange={c => setInfo(`onSelectionChange: ${c.length} sel`)}
            onNodeAdded={(_c, t) => setInfo(`onNodeAdded: ${t?.label}`)}
            validateConnection={(s, t) => s !== t}
            fallback={<div class="sjx-loading">Memuat editor diagram…</div>}
          />
        </div>
        <div style={{ "font-size": "12px", color: "#64748b" }}>
          {info() || "Event akan tampil di sini."} <button type="button" onClick={() => console.log(api?.getXml())} style={{ "margin-left": "8px" }}>log XML</button>
        </div>
      </div>
    </div>
  );
}
