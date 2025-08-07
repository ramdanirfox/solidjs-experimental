import { Accessor, createEffect, createSignal, onMount } from "solid-js";
import { GeoJsonLayer, IconLayer, ArcLayer, PathLayer, COORDINATE_SYSTEM } from "deck.gl";
import { PathStyleExtension } from "@deck.gl/extensions";
import { GoogleMapsOverlay } from "@deck.gl/google-maps";
import { AtlasService } from "~/shared/services/atlas.service";
import AtlasUtil from "~/shared/utils/atlas.util";
import { MapDataService } from "~/shared/services/map-data.service";
import { EditableGeoJsonLayer, DrawPolygonMode } from "@deck.gl-community/editable-layers";
import { DeckGLUtils } from "~/shared/utils/deckgl.util";

interface ISJXGoogleDeckLayerCmpRefs {
    // fnUpdateView: () => void
    // fnUpdateData: (data: any) => void
}

interface ISJXGoogleDeckLayer {
    sigZoom: Accessor<number>;
    gmapref: any;
    onReady: (ref: ISJXGoogleDeckLayerCmpRefs) => void
}

export default function SJXGoogleDeckLayer(props: ISJXGoogleDeckLayer) {
    const [sigZoomLevel, setSigZoomLevel] = createSignal(3);
    const deckExtensions = {
        PathStyleExtension
    };
    const deckEditable = {
        EditableGeoJsonLayer,
        DrawPolygonMode
    };
    const deckGoogle = {
        GoogleMapsOverlay
    };
    const deck = {
        GeoJsonLayer,
        IconLayer,
        PathLayer,
        ArcLayer
    };
    let deckOverlay: any;
    let atlasName = "marker_atlas";
    let preGeneratedIconMapping: any;
    let rawData: any;
    let deckLayers = {
        icon: (): any => { alert("Icon Layer is not ready"); }, // this icon layer use sprite from http://free-tex-packer.com/
        editable: (): any => { alert("Editable Layer is not ready"); },
        path: (): any => { alert("Path Layer is not ready"); },
        dashedArcPath: (): any => { alert("Arc Layer is not ready"); },
        staticEditable: undefined as any
    };
    let mapref: any;
    const thismapAtlasImage = `${AtlasService.apiAtlasUrl}/${atlasName}.png`;
    const selectedFeatureIndexes = [] as any;
    const thismapConfig = {
        fnGetScale: (base: number) => {
            const skala = Math.pow((props.sigZoom()) * base / 60, 2);
            console.log("scale into", skala);
            return Math.min(skala, 34.41777777777777);
        }
    }

    onMount(() => {
        mapref = props.gmapref;
        MapDataService.getMapData("geojson.json").then((y) => {
            rawData = y;
            AtlasService.getAtlasDefinition(atlasName + ".json").then(x => {
                console.log("atlasdef", x);
                preGeneratedIconMapping = AtlasUtil.getIconMappingFromTexPackerJSONHash(x);
                fnLoadDeckGL();
            });
        })
    });


    const fnDefineDeckLayers = () => {
        deckLayers.icon = (): any => {
            return new deck.GeoJsonLayer({
                id: "icon-layer",
                data: rawData,
                pickable: true,
                pointType: 'icon',
                iconAtlas: thismapAtlasImage,
                // getIcon: (d: any) => { return `${d.properties.site_class}_${d.properties.bbt_category}.png` },
                getIcon: (d: any) => { return `im_critical.png` },
                // onClick: (info: any) => {
                //     alert(JSON.stringify(info.object));
                // },
                iconSizeScale: thismapConfig.fnGetScale(32),
                iconMapping: preGeneratedIconMapping,
                // getFilterValue: (f: any) => [siteFilterProcessor(f)],
                // filterRange: [[0.9, 1]],
                // extensions: [dataFilterExt],
            });
        };

        const path = [[38.35, 173.65], [293.1, -81.1], [303.65, -96.2], [308.45, -114.05], [306.85, -132.45], [299, -149.15], [285.95, -162.2], [269.25, -170.05], [250.85, -171.6], [233, -166.85], [217.9, -156.25], [-7.6, 69.25], [-22.7, 81.8], [-39.9, 91.4], [-58.6, 97.6], [-78.1, 100.25], [-97.75, 99.3], [-116.9, 94.75], [-134.9, 86.7], [-151.05, 75.45], [-164.9, 61.45], [-175.95, 45.15], [-183.8, 27.1], [-188.15, 7.9], [-188.85, -11.75], [-186, -31.25], [-179.55, -49.85], [-169.75, -66.95], [-157, -81.9], [-141.7, -94.35], [-124.4, -103.7], [-105.65, -109.7], [-86.1, -112.15], [-66.45, -110.95], [-47.4, -106.2], [-29.5, -97.95], [-13.45, -86.5], [1.45, -73.9], [19.65, -66.55], [39.25, -66.35], [57.6, -73.25], [72.2, -86.3], [81.05, -103.8], [83, -123.3], [77.7, -142.15], [65.95, -157.85], [49.3, -168.2], [30.05, -171.8], [-288.85, -171.8]];
        deckLayers.path = (): any => {
            return new deck.PathLayer({
                id: "path-layer",
                data: [{ path }],
                coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
                coordinateOrigin: [106.8167, -6.1754] as any,
                getPath: d => d.path,
                getWidth: 2,
                getColor: [60, 100, 160],
                widthUnits: "pixels",

                // props added by PathStyleExtension
                getDashArray: [4, 3],
                dashJustified: false,
                extensions: [new PathStyleExtension({ highPrecisionDash: true })]
            });
        };

        deckLayers.dashedArcPath = (): any => {
            const data = [
                {
                    pickup: [105.9955409814338, -8.403480081564624],
                    dropoff: [112.6535629832967, -7.375859742310922],
                    height: 500000,
                    tripStartTime: 5,
                    tripEndTime: 0
                }
            ]
            return new deck.PathLayer({
                data,
                id: "dashed-arc-path",
                billboard: true,
                widthScale: 20,
                // widthUnits:
                widthMinPixels: 1,
                getPath: d => DeckGLUtils.pathArc(d) as any,
                getColor: d => [0, 128, 255],
                getWidth: d => 5,
                getDashArray: [3, 2],
                dashJustified: true,
                dashGapPickable: true,
                extensions: [new deckExtensions.PathStyleExtension({ highPrecisionDash: true })]
            });
        };

        deckLayers.editable = (): any => {
            return new deckEditable.EditableGeoJsonLayer({
                id: 'geojson-layer-editable',
                data: rawData,
                mode: deckEditable.DrawPolygonMode,
                selectedFeatureIndexes: selectedFeatureIndexes,
                pickable: true,
                onClick: (info: any) => {
                    console.log("Clicked Editable", info);
                },
                onEdit: (e: any) => {
                    console.log("Edited feature", e)
                }
            });
        }

        deckLayers.staticEditable = deckLayers.editable();
    }

    const fnAttachDeckGL = () => {
        let deckinterface = new deckGoogle.GoogleMapsOverlay({
            interleaved: false,
            getCursor: deckLayers.staticEditable.getCursor.bind(deckLayers.staticEditable),
            layers: [
                ...fnGetLayerList()
            ],
            style: {
                zIndex: "10000"
            },
        });
        deckOverlay = deckinterface;
        deckinterface.setMap(mapref);
        console.log("DeckGL Overlay Loaded", deckOverlay, deckLayers);
    }

    const fnLoadDeckGL = () => {
        fnDefineDeckLayers();
        fnAttachDeckGL();
    };

    const fnUpdateDeckGL = () => {
        // console.log("Updating deckgl..", deckOverlay);
        deckOverlay.setProps({
            layers: [
                ...fnGetLayerList()
            ]
        })
    }

    const fnGetLayerList = () => {
        return [
            deckLayers.icon(),
            deckLayers.staticEditable,
            deckLayers.path(),
            deckLayers.dashedArcPath()
        ];
    }

    createEffect(() => {
        props.sigZoom();
        if (deckOverlay) {
            fnUpdateDeckGL();
        }
    });
    return <>
    </>
}