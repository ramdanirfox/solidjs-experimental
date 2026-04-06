import { useNavigate } from "@solidjs/router";
import { Accessor, Show, Suspense } from "solid-js";

interface ISJXRootContainerProps {
    children: any;
    sigNavigateUrl?: Accessor<string>;
    sigNavigateCounter?: Accessor<number>;
}

export default function SJXRootContainer(props: ISJXRootContainerProps) {
    const navigate = useNavigate();
    const fnCheck = () => {
        alert("Check function called : " + JSON.stringify(import.meta.env) + " --- ");
    }

    const fnToHome = () => {
        navigate("/");
    }
    return (
        <>
            <button onClick={fnCheck}>Check</button>
            <button onClick={fnToHome}>To Home</button>
            <Show when={props.sigNavigateUrl}>
                <span>url: {props.sigNavigateUrl?.()} --- </span>
            </Show>
            <Show when={props.sigNavigateCounter}>
                <span>navcount: {props.sigNavigateCounter?.()}</span>
            </Show>
            <Suspense>
                {props.children}
            </Suspense>
        </>
    )
}