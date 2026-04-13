import { Component, createSignal, onMount, Show } from "solid-js";
import GoldenAppRoot from "~/shared/components/golden-layout/golden-app-root";
import Counter from "./Counter";
import { useSJXContext } from "~/shared/context/SJXContext";

export const GoldenLayoutView2: Component<any> = () => {
    const SJXctx = useSJXContext();
    return <>
        <GoldenAppRoot
            jsxComponents={[
                () => <div>Hallo Dunia</div>,
                () => <h2>Apa Kabar {SJXctx?.ctx.increments.val()}</h2>,
                () => <Counter />
            ]}
        />
    </>
};