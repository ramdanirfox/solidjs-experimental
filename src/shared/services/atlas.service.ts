import { createSignal } from "solid-js";


export const AtlasService = {
    apiAtlasUrl: "src/assets/atlas",
    apiControllers: {} as { [key: number | string]: AbortController },
    getAtlasDefinition: async function (atlasname: string) {
        const controller = new AbortController();

        const [data, setData] = createSignal();
        const [error, setError] = createSignal();

        const url = `${this.apiAtlasUrl}/${atlasname}`;
        await fetch(url,
            {
                headers: { 'Content-Type': 'application/json' },
                method: 'GET',
                signal: controller.signal
            }
        ).then((res) => res.json())
            .then((data: any) => {
                setData(data);
            }
            ).catch((err) => {
                setError(err);
                alert("[FATAL ERROR] Cannot Retrieve Atlas Definition")
                let dummyresponse = {};
                setData(dummyresponse);
                console.log('Error', dummyresponse);
            });
        return data();
    }
}