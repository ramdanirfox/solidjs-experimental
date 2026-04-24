import { Accessor, JSX, Match, onCleanup, onMount, Show, Switch } from "solid-js";
import { NoHydration, Portal, isServer } from "solid-js/web";
import { useSJXContext } from "~/shared/context/SJXContext";
import { clientOnly } from "@solidjs/start";

interface IGoldenComponentWrapper {
    currentIndex: number,
    maxIndex: number,
    jsxComponents: (JSX.Element | (() => JSX.Element))[],
    state: any,
    itemRef?: any;
    sigMemorizedContainerStyle?: Accessor<any>;
    sigIsPopup?: Accessor<boolean>;
}

export const GoldenComponentWrapper = (props: IGoldenComponentWrapper) => {
    const SJXctx = useSJXContext();
    onMount(() => console.log("[GoldenComponentWrapper] It supposed to load component " + props.currentIndex));
    onCleanup(() => console.log("[GoldenComponentWrapper] It supposed to unload component " + props.currentIndex));

    const fnGlFindContentItem = () => {
        const c = props.itemRef.component.container;
        // const cid = c._config.id;
        if (c) {
            const containerGl = c;
            const origid = containerGl._config.id;
            let contentItem: any;
            console.log("[GoldenComponentWrapper] containerGl.parent.parent.contentItems", containerGl.parent.parent.contentItems, containerGl, origid);
            for (let i = 0; i < containerGl.parent.parent.contentItems.length; i++) {
                const containerGlId = containerGl.parent.parent.contentItems[i].id;
                if (containerGlId == origid) {
                    contentItem = containerGl.parent.parent.contentItems[i];
                    break;
                }
            }
            return contentItem;
        }
        else {
            console.log("[GoldenComponentWrapper] glContainerRef/c is undefined");
        }
    }

    const fnHandleTabClick = (e: any) => {
        const glContentItem = fnGlFindContentItem();
        console.log("[GoldenComponentWrapper] Custom Tab Clicked", e, glContentItem);
        if (glContentItem) {
            // console.log("[GoldenComponentWrapper] Tab Clicked, contentItem found", glContentItem);
            glContentItem.tab.onTabClickDown(e);
        }
    }

    const fnHandleTabPointerDown = (e: any) => {
        const glContentItem = fnGlFindContentItem();
        if (glContentItem) {
            console.log("[GoldenComponentWrapper] Tab Pt Down, contentItem found", glContentItem, e);

            const forwardedEvent = new PointerEvent("pointerdown", {
                bubbles: true,
                cancelable: true,
                pointerId: e.pointerId,
                isPrimary: e.isPrimary,
                clientX: e.clientX,
                clientY: e.clientY,
            });
            glContentItem.tab.element.dispatchEvent(forwardedEvent);
        }
    }

    const fnHandleTabTouchStart = (e: any) => {
        const glContentItem = fnGlFindContentItem();
        if (glContentItem) {
            console.log("[GoldenComponentWrapper] Tab Touch Start, contentItem found", glContentItem, e);
            const forwardedEvent = new TouchEvent("touchstart", {
                bubbles: true,
                cancelable: true,
                touches: Array.from(e.touches),
                targetTouches: Array.from(e.targetTouches),
                changedTouches: Array.from(e.changedTouches),
                // Properti krusial agar 'target' bisa dimanipulasi melalui dispatch
            });
            glContentItem.tab.element.dispatchEvent(forwardedEvent);
        }
    }

    const fnHandlePointerCancel = (e: any) => {
        console.warn("DEBUG: Pointer Cancel Terdeteksi!", {
            pointerId: e.pointerId,
            pointerType: e.pointerType, // mouse, touch, atau pen
            target: e.target,
            reason: "Biasanya karena interupsi browser (scroll/gesture)"
        });
    };

    const SJXInternalCmpToolbox = () => <div class="select-none touch-none"
        onClick={fnHandleTabClick}
        onPointerDown={fnHandleTabPointerDown}
        onPointerCancel={fnHandlePointerCancel}
        onTouchStart={fnHandleTabTouchStart}>
        Drag Here!
    </div>

    // const SJXInternalCmpClientOnlyCmp = clientOnly(() => <>
    //     <SJXInternalCmpToolbox />
    //     {typeof props.jsxComponents[props.currentIndex] == "function" ? (props.jsxComponents[props.currentIndex] as (() => JSX.Element | any))() : props.jsxComponents[props.currentIndex]}
    // </>);

    return (<>
        <Switch fallback={<div class="overflow-auto">
            <h1>SolidGoldenView Not Found</h1>
            <p>Current Index: {props.currentIndex}</p>
            <p>Max Index: {props.maxIndex}</p>
            <p>State: {JSON.stringify(props.state)}</p>
            <p>ctxcnt: cnt={SJXctx?.ctx.increments.val()}</p>
        </div>}>

            <Match when={props.jsxComponents[props.currentIndex] && props.state.jsxPreservationMode == "static-host" && props.sigIsPopup?.()}>
                <Portal mount={props.itemRef.rootElement}>
                    <SJXInternalCmpToolbox />
                    {typeof props.jsxComponents[props.currentIndex] == "function" ? (props.jsxComponents[props.currentIndex] as (() => JSX.Element | any))() : props.jsxComponents[props.currentIndex]}
                </Portal>
            </Match>

            <Match when={props.jsxComponents[props.currentIndex] && props.state.jsxPreservationMode == "static-host"}>
                {/* <NoHydration>
                    <h1>SolidGoldenView Iframe</h1>
                    <p>Current Index: {props.currentIndex}</p>
                    <p>Max Index: {props.maxIndex}</p>
                    <p>State: {JSON.stringify(props.state)}</p>
                    <p>ctxcnt: cnt={SJXctx?.ctx.increments.val()}</p> */}
                {/* <Show when={!isServer} fallback={<></>}> */}
                <div class="sjx-static-host" style={{
                    width: props.sigMemorizedContainerStyle?.()[props.itemRef.component.container._config.id]?.width,
                    height: props.sigMemorizedContainerStyle?.()[props.itemRef.component.container._config.id]?.height,
                    left: props.sigMemorizedContainerStyle?.()[props.itemRef.component.container._config.id]?.left,
                    top: props.sigMemorizedContainerStyle?.()[props.itemRef.component.container._config.id]?.top,
                    "z-index": props.sigMemorizedContainerStyle?.()[props.itemRef.component.container._config.id]?.zIndex == "auto" ? "1" : props.sigMemorizedContainerStyle?.()[props.itemRef.component.container._config.id]?.zIndex,
                    display: props.sigMemorizedContainerStyle?.()[props.itemRef.component.container._config.id]?.display,
                }}>
                    <SJXInternalCmpToolbox />
                    {typeof props.jsxComponents[props.currentIndex] == "function" ? (props.jsxComponents[props.currentIndex] as (() => JSX.Element | any))() : props.jsxComponents[props.currentIndex]}
                </div>
                {/* </Show> */}
                {/* </NoHydration> */}
            </Match>

            <Match when={props.jsxComponents[props.currentIndex]}>
                <Portal mount={props.itemRef.rootElement}>
                    <SJXInternalCmpToolbox />
                    {typeof props.jsxComponents[props.currentIndex] == "function" ? (props.jsxComponents[props.currentIndex] as (() => JSX.Element | any))() : props.jsxComponents[props.currentIndex]}
                </Portal>
            </Match>
        </Switch>
    </>
    );
}