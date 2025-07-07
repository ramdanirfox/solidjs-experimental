import { createSignal } from "solid-js";


export const MapDataService = {
    apiDataUrl: "src/assets/json",
    apiControllers: {} as { [key: number | string]: AbortController },
    getMapData: async function (fileName: string) {
        const controller = new AbortController();

        const [data, setData] = createSignal();
        const [error, setError] = createSignal();

        const url = `${this.apiDataUrl}/${fileName}`;
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