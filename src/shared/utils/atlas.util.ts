const AtlasUtil = {
    getIconMappingFromTexPackerJSONHash: function (atlasjson: any, useMask = false) {
        let atlascompat: any = {};
        for (let spname in atlasjson.frames) {
            atlascompat[spname] = {
                ...atlasjson.frames[spname].frame,
                mask: useMask,
                width: atlasjson.frames[spname].frame.w,
                height: atlasjson.frames[spname].frame.h
            };
            delete atlascompat[spname].h;
            delete atlascompat[spname].w;
        }
        console.log("Generated Atlasmap", atlascompat);
        return atlascompat;
    }
}

export default AtlasUtil;