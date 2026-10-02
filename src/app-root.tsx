import { A, useLocation, useNavigate } from "@solidjs/router";
import { Accessor, createEffect, createSignal, For, Show, Suspense } from "solid-js";
import { APP_DEV_BASEURL } from "./shared/constants/app.constant";
import "./app-root.css";
// import "./shared/styles/animation.css"

interface ISJXRootContainerProps {
    children: any;
    sigNavigateUrl?: Accessor<string>;
    sigNavigateCounter?: Accessor<number>;
}

/** Daftar halaman contoh yang muncul di navigasi atas. */
export const SJX_NAV_ITEMS = [
    { href: "/xlsx-preview", label: "XLSX Preview", badge: "Baru" },
    { href: "/golden-layout", label: "Golden Layout" },
    { href: "/svar", label: "Svar Gantt" },
    { href: "/aggrid", label: "AG Grid" },
    { href: "/solid-google-maps", label: "Google Maps" },
    { href: "/chart-3d", label: "3D Chart" },
    { href: "/globe-maplibre", label: "Globe" },
];

export default function SJXRootContainer(props: ISJXRootContainerProps) {
    const navigate = useNavigate();
    const location = useLocation();
    const [sigAutoDecision, setSigAutoDecision] = createSignal(0);
    const fnCheck = () => {
        alert("Check function called : " + JSON.stringify(import.meta.env) + " --- ");
    }
    const fnToHome = () => {
        navigate("/");
    }
    const isHome = () => {
        const p = location.pathname.replace(/\/+$/, "");
        return p === "" || p === APP_DEV_BASEURL.replace(/\/+$/, "");
    };
    const isActive = (href: string) => {
        const p = location.pathname.replace(/\/+$/, "");
        return p.endsWith(href);
    };

    createEffect(() => {
        const sub = props.sigNavigateUrl ? props.sigNavigateUrl() : null;
        if (sub && !sub.includes(APP_DEV_BASEURL) && (APP_DEV_BASEURL + "") != "/") {
            console.log("Value of: " + !sub?.includes(APP_DEV_BASEURL));
            setSigAutoDecision(s => s + 1);
            navigate("/");
        }
    });

    return (
        <div class="sjx-shell">
            <header class="sjx-header">
                <button class="sjx-brand" onClick={fnToHome} title="Kembali ke beranda">
                    <span class="sjx-logo" aria-hidden="true">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7l8-4 8 4-8 4-8-4z" /><path d="M4 12l8 4 8-4" /><path d="M4 17l8 4 8-4" /></svg>
                    </span>
                    <span class="sjx-brand-text">
                        <b>SolidJS</b> Experimental
                    </span>
                </button>
                <nav class="sjx-nav" aria-label="Contoh komponen">
                    <A href="/" end class="sjx-nav-link" classList={{ active: isHome() }}>Beranda</A>
                    <For each={SJX_NAV_ITEMS}>
                        {(it) => (
                            <A href={it.href} class="sjx-nav-link" classList={{ active: isActive(it.href) }}>
                                {it.label}
                                <Show when={it.badge}><span class="sjx-badge">{it.badge}</span></Show>
                            </A>
                        )}
                    </For>
                </nav>
                <details class="sjx-dev">
                    <summary title="Alat bantu pengembang">dev</summary>
                    <div class="sjx-dev-pop">
                        <button onClick={fnCheck}>Cek env</button>
                        <button onClick={fnToHome}>To Home</button>
                        <Show when={props.sigNavigateUrl}><div>url: <code>{props.sigNavigateUrl?.()}</code></div></Show>
                        <Show when={props.sigNavigateCounter}><div>navcount: {props.sigNavigateCounter?.()}</div></Show>
                        <div>autodecision: {sigAutoDecision()}</div>
                    </div>
                </details>
            </header>
            <div class="sjx-content">
                <Suspense fallback={<div class="sjx-loading">Memuat halaman…</div>}>
                    {props.children}
                </Suspense>
            </div>
        </div>
    )
}
