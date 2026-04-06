import { useNavigate } from "@solidjs/router";
import { Accessor, createEffect, createSignal, Show, Suspense } from "solid-js";
import { APP_DEV_BASEURL } from "./shared/constants/app.constant";

interface ISJXRootContainerProps {
    children: any;
    sigNavigateUrl?: Accessor<string>;
    sigNavigateCounter?: Accessor<number>;
}

export default function SJXRootContainer(props: ISJXRootContainerProps) {
    const navigate = useNavigate();
    const [sigAutoDecision, setSigAutoDecision] = createSignal(0);
    const fnCheck = () => {
        alert("Check function called : " + JSON.stringify(import.meta.env) + " --- ");
    }
    const fnToHome = () => {
        navigate("/");
    }

    createEffect(() => {
        const sub = props.sigNavigateUrl ? props.sigNavigateUrl() : null;
        if (sub && !sub.includes(APP_DEV_BASEURL) && (APP_DEV_BASEURL + "") != "/") {
            console.log("Value of: " + !sub?.includes(APP_DEV_BASEURL));
            setSigAutoDecision(s => s + 1);
            navigate("/");
        }
    });

    return (
        <>
            <button onClick={fnCheck}>Check</button>
            <button onClick={fnToHome}>To Home</button>
            <Show when={props.sigNavigateUrl}>
                <span>url: {props.sigNavigateUrl?.()} --- </span>
            </Show>
            <Show when={props.sigNavigateCounter}>
                <span>navcount: {props.sigNavigateCounter?.()} --- </span>
            </Show>
            {/* <Show when={props.sigNavigateCounter}> */}
                <span>autodecision: {sigAutoDecision()} --- </span>
            {/* </Show> */}
            <Suspense>
                {props.children}
            </Suspense>
        </>
    )
}