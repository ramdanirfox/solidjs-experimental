// //==============================================================================

// import { ArcLayer } from "deck.gl"

// const transparencyCheck = '|| length(vColor) == 0.0'

// class ArcMapLayer extends ArcLayer
// {
//     static layerName = 'ArcMapLayer'

//     constructor(...args: {
//             id: string; data: any[]; pickable: boolean; autoHighlight: boolean; numSegments: number
//             // Styles
//             getSourcePosition: (f: any) => any; getTargetPosition: (f: any) => any; getSourceColor: any; getTargetColor: any; highlightColor: (o: any) => any; opacity: number; getWidth: number
//         }[])
//     {
//         super(...args)
//     }

//     getShaders()
//     //==========
//     {
//         const shaders = super.getShaders()
//         shaders.fs = `#version 300 es\n${shaders.fs}`
//                      .replace('isValid == 0.0', `isValid == 0.0 ${transparencyCheck}`)
//         shaders.vs = `#version 300 es\n${shaders.vs}`
//         return shaders
//     }

//     redraw()
//     //======
//     {
//         if (this.internalState) {
//             this.internalState.changeFlags.dataChanged = true as any
//             this.setNeedsUpdate()
//         }
//     }
// }

// //==============================================================================

// const makeDashedTriangles = `  float alpha = floor(fract(float(gl_VertexID)/12.0)+0.5);
//   if (vColor.a != 0.0) vColor.a *= alpha;
// `

// class ArcDashedLayer extends ArcMapLayer
// {
//     static layerName = 'ArcDashedLayer'

//     constructor(...args: any)
//     {
//         super(...args)
//     }

//     getShaders()
//     //==========
//     {
//         const shaders = super.getShaders()
//         shaders.vs = shaders.vs.replace('DECKGL_FILTER_COLOR(', `${makeDashedTriangles}\n  DECKGL_FILTER_COLOR(`)
//         return shaders
//     }

//     _getModel(gl: any)
//     //===========
//     {
//         const {numSegments} = this.props
//         let positions = []
//         for (let i = 0; i < numSegments; i++) {
//             positions = positions.concat([i,  1, 0, i,  -1, 0, i+1,  1, 0,
//                                           i, -1, 0, i+1, 1, 0, i+1, -1, 0])
//         }
//         const model = new Model(gl, {
//             ...this.getShaders(),
//             id: this.props.id,
//             geometry: new Geometry({
//                 drawMode: GL.TRIANGLES,
//                 attributes: {
//                     positions: new Float32Array(positions)
//                 }
//             }),
//             isInstanced: true,
//         })
//         model.setUniforms({numSegments: numSegments})
//         return model
//     }
// }

// //==============================================================================

// export class Paths3DLayer
// {
//     #arcLayers = new Map()

//     #layerOptions(pathType)
//     //=====================
//     {
//         const pathData = [...this.#pathData.values()]
//                                  .filter(ann => (this.#knownTypes.includes(ann.kind) && (ann.kind === pathType)
//                                              || !this.#knownTypes.includes(ann.kind) && (pathType === 'other')))
//         return {
//             id: `arc-${pathType}`,
//             data: pathData,
//             pickable: true,
//             autoHighlight: true,
//             numSegments: 400,
//             // Styles
//             getSourcePosition: f => f.pathStartPosition,
//             getTargetPosition: f => f.pathEndPosition,
//             getSourceColor: this.#pathColour.bind(this),
//             getTargetColor: this.#pathColour.bind(this),
//             highlightColor: o => this.#pathColour(o.object),
//             opacity: 1.0,
//             getWidth: 3,
//         }
//     }

//     #addArcLayer(pathType)
//     //====================
//     {
//         const layer = this.#pathStyles.get(pathType).dashed
//                         ? new ArcDashedLayer(this.#layerOptions(pathType))
//                         : new ArcMapLayer(this.#layerOptions(pathType))
//         this.#arcLayers.set(pathType, layer)
//     }

//     #setupDeckOverlay()
//     //=================
//     {
//         [...this.#pathStyles.values()].filter(style => this.#pathManager.pathTypeEnabled(style.type))
//                                       .forEach(style => this.#addArcLayer(style.type))
//         this.#deckOverlay = new DeckOverlay({
//             layers: [...this.#arcLayers.values()],
//         })
//     }
// }

// //==============================================================================