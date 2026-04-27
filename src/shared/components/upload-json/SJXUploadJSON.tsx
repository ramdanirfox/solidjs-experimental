import { createSignal } from "solid-js";

export interface ISJXUploadJSON {
    onUpload: (d: any) => void;
    label: string;
}

export default function SJXUploadJSON(props: ISJXUploadJSON) {
    const [fileName, setFileName] = createSignal("");

    const handleFileUpload = (event: any) => {
        const file = event.target.files[0];
        if (!file) return;

        setFileName(file.name);

        const reader = new FileReader();
        reader.onload = (e: any) => {
            try {
                const json = JSON.parse(e.target.result);

                // Pass the data back to the parent via props
                if (props.onUpload) {
                    props.onUpload(json);
                }
            } catch (err) {
                console.error("Invalid JSON file", err);
                alert("Failed to parse JSON.");
            }
        };
        reader.readAsText(file);
    };

    return (
        <div class="flex flex-col gap-2 p-4 bg-white border border-slate-200 rounded-xl shadow-sm max-w-sm">
            <label class="flex flex-col gap-1 text-sm font-medium text-slate-700 cursor-pointer">
                {props.label || "Upload JSON"}
                {/* <div class="mt-1 flex items-center justify-center w-full px-4 py-3 border-2 border-dashed border-slate-300 rounded-lg hover:border-blue-400 hover:bg-blue-50 transition-all duration-200 group"> */}
                    {/* <div class="flex flex-col items-center gap-1">
                        <svg xmlns="http://w3.org" class="w-6 h-6 text-slate-400 group-hover:text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                        </svg>
                        <span class="text-xs text-slate-500">Click to browse or drag and drop</span>
                    </div> */}
                    <input
                        type="file"
                        accept=".json"
                        onChange={handleFileUpload}
                        class="hidden"
                    />
                {/* </div> */}
            </label>

            {fileName() && (
                <div class="flex items-center gap-2 px-3 py-2 bg-emerald-50 text-emerald-700 text-xs font-semibold rounded-md border border-emerald-100 animate-in fade-in slide-in-from-top-1">
                    <span class="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span>
                    Loaded: <span class="truncate italic">{fileName()}</span>
                </div>
            )}
        </div>
    );
}