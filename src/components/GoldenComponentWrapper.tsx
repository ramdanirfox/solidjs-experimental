import { JSX, Show } from "solid-js";
import { useSJXContext } from "~/shared/context/SJXContext";

interface IGoldenComponentWrapper {
    currentIndex: number,
    maxIndex: number,
    jsxComponents: JSX.Element[],
    state: any
}

export const  GoldenComponentWrapper = (props: IGoldenComponentWrapper) => {
    const SJXctx = useSJXContext();
    return (<>
    <Show when={props.jsxComponents[props.currentIndex]} fallback={<>
        <h1>SolidGoldenView Not Found</h1>
        <p>Current Index: {props.currentIndex}</p>
        <p>Max Index: {props.maxIndex}</p>
        <p>State: {JSON.stringify(props.state)}</p>
        <p>ctxcnt: cnt={SJXctx?.ctx.increments.val()}</p>
        </>}>
        <div>
        {props.jsxComponents[props.currentIndex]} cnt={SJXctx?.ctx.increments.val()}
        </div>
        <div>
            cnt={SJXctx?.ctx.increments.val()}
        </div>
    </Show>
        
    </>
    );
}