import { Accessor, createEffect, createSignal, onMount } from "solid-js";
import * as deck from "deck.gl";
import * as deckGoogle from "@deck.gl/google-maps";
import { AtlasService } from "~/shared/services/atlas.service";
import AtlasUtil from "~/shared/utils/atlas.util";
import { MapDataService } from "~/shared/services/map-data.service";

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
    let deckOverlay: any;
    let atlasName = "marker_atlas";
    let preGeneratedIconMapping: any;
    let rawData: any;
    let deckLayers = {
        icon: (): any => { alert("Icon Layer is not ready"); }, // this icon layer use sprite from http://free-tex-packer.com/
    };
    let mapref: any;
    const thismapAtlasImage = `${AtlasService.apiAtlasUrl}/${atlasName}.png`;
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
                iconSizeScale: thismapConfig.fnGetScale(32),
                iconMapping: preGeneratedIconMapping,
                // getFilterValue: (f: any) => [siteFilterProcessor(f)],
                // filterRange: [[0.9, 1]],
                // extensions: [dataFilterExt],
            });
        };
    }

    const fnAttachDeckGL = () => {
        let deckinterface = new deckGoogle.GoogleMapsOverlay({
            interleaved: false,
            layers: [
                deckLayers.icon(),
                // this.textLayer(),
            ],
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
        console.log("Updating deckgl..");
        deckOverlay.setProps({
            layers: [
                deckLayers.icon(),
            ]
        })
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