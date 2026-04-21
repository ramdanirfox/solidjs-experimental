import { JSX, onCleanup, onMount, Show } from "solid-js";
import { useSJXContext } from "~/shared/context/SJXContext";

interface IGoldenComponentWrapper {
    currentIndex: number,
    maxIndex: number,
    jsxComponents: (JSX.Element | (() => JSX.Element))[],
    state: any,
    glContainerRef?: any
}

export const GoldenComponentWrapper = (props: IGoldenComponentWrapper) => {
    const SJXctx = useSJXContext();
    onMount(() => console.log("[GoldenComponentWrapper] It supposed to load component " + props.currentIndex));
    onCleanup(() => console.log("[GoldenComponentWrapper] It supposed to unload component " + props.currentIndex));

    const fnGlFindContentItem = () => {
        if (props.glContainerRef) {
            const containerGl = props.glContainerRef;
            const origid = containerGl._config.id;
            let contentItem: any;
            for (let i = 0; i < containerGl.parent.parent.contentItems.length; i++) {
                const containerGlId = containerGl.parent.parent.contentItems[i].id;
                if (containerGlId == origid) {
                    contentItem = containerGl.parent.parent.contentItems[i];
                    break;
                }
            }
            return contentItem;
        }
    }

    const fnHandleTabClick = (e: any) => {
        const glContentItem = fnGlFindContentItem();
        if (glContentItem) {
            // console.log("[GoldenComponentWrapper] Tab Clicked, contentItem found", glContentItem);
            glContentItem.tab.onTabClickDown(e);
        }
    }

    const fnHandleTabPointerDown = (e: any) => {
        const glContentItem = fnGlFindContentItem();
        if (glContentItem) {
            console.log("[GoldenComponentWrapper] Tab Pt Down, contentItem found", glContentItem, e);

            // const target = e.currentTarget;

            // target.addEventListener('gotpointercapture', (ev: any) => {
            //     console.log("DEBUG: Pointer Capture Diterima!", {
            //         pointerId: ev.pointerId,
            //         pointerType: ev.pointerType
            //     });
            //     ev.target.releasePointerCapture(ev.pointerId);
            // }, { once: true });

            // const tabElement = glContentItem.tab.element;
            // const rect = tabElement.getBoundingClientRect();

            // const simulatedX = rect.left + (rect.width / 2);
            // const simulatedY = rect.top + (rect.height / 2);

            const forwardedEvent = new PointerEvent("pointerdown", {
                bubbles: true,
                cancelable: true,
                pointerId: e.pointerId,
                isPrimary: e.isPrimary,
                clientX: e.clientX,
                clientY: e.clientY,
                // clientX: simulatedX,
                // clientY: simulatedY,
                // button: 0,
                // buttons: 1,
                // view: window
                // Properti lain yang dibutuhkan getPointerCoordinates()
            });
            glContentItem.tab.element.dispatchEvent(forwardedEvent);
            // glContentItem.tab._dragListener.onPointerDown(e);
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

    const handlePointerCancel = (e: any) => {
        console.warn("DEBUG: Pointer Cancel Terdeteksi!", {
            pointerId: e.pointerId,
            pointerType: e.pointerType, // mouse, touch, atau pen
            target: e.target,
            reason: "Biasanya karena interupsi browser (scroll/gesture)"
        });
    };

    return (<>
        <div class="select-none touch-none"
            onClick={fnHandleTabClick}
            onPointerDown={fnHandleTabPointerDown}
            onPointerCancel={handlePointerCancel}
            onTouchStart={fnHandleTabTouchStart}>
            Drag Here!
        </div>
        <Show when={props.jsxComponents[props.currentIndex]} fallback={<>
            <h1>SolidGoldenView Not Found</h1>
            <p>Current Index: {props.currentIndex}</p>
            <p>Max Index: {props.maxIndex}</p>
            <p>State: {JSON.stringify(props.state)}</p>
            <p>ctxcnt: cnt={SJXctx?.ctx.increments.val()}</p>
        </>}>
            {typeof props.jsxComponents[props.currentIndex] == "function" ? (props.jsxComponents[props.currentIndex] as (() => JSX.Element | any))() : props.jsxComponents[props.currentIndex]}
        </Show>
    </>
    );
}