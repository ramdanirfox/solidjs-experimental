import { Component, createSignal, onMount, Show } from "solid-js";
import GoldenAppRoot from "~/shared/components/golden-layout/golden-app-root";
import Counter from "./Counter";
import { useSJXContext } from "~/shared/context/SJXContext";
import "./../shared/styles/golden-layout.css";
import "golden-layout/dist/css/goldenlayout-base.css";
import "golden-layout/dist/css/themes/goldenlayout-light-theme.css";

export const GoldenLayoutView2: Component<any> = () => {
    const SJXctx = useSJXContext();
    return <>
        <GoldenAppRoot
            jsxComponents={[
                () => <div>Hallo Dunia</div>,
                () => <GoldenAppRoot jsxComponents={[
                    () => <div>Pagiku cerah!</div>,
                    () => <div>Matahari bersinar!</div>,
                ]} />,
                // () => <Counter />,
                () => <h2>Apa Kabar {SJXctx?.ctx.increments.val()}</h2>,
            ]}
        />
    </>
};