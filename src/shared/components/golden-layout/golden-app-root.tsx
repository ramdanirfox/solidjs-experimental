import {
    ComponentContainer,
    ComponentItemConfig,
    ContentItem,
    EventEmitter,
    GoldenLayout,
    JsonValue,
    LayoutConfig,
    LayoutManager,
    LogicalZIndex,
    ResolvedComponentItemConfig,
    ResolvedLayoutConfig,
    Stack
} from 'golden-layout';
import { BooleanComponent } from './boolean-component';
import { ColorComponent } from './color-component';
import { EventComponent } from './event-component';
import { Layout, prefinedLayouts } from './predefined-layouts';
import { TextComponent } from './text-component';
import { ComponentBase } from './component-base';
import { SolidGoldenFactory, SolidGoldenWrapperComponent } from './solidgolden-wrapper-component';
import { createRenderEffect, createSignal, For, JSX, onCleanup, onMount, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { GoldenComponentWrapper } from '~/components/GoldenComponentWrapper';
import { createStore } from 'solid-js/store';

interface GenericObject {
    [key: string]: any;
}

export interface IGoldenAppRootProps {
    jsxComponents: (JSX.Element | (() => JSX.Element))[]
    onLayoutUpdate?: (a: any) => void
}

export default function GoldenAppRoot(props: IGoldenAppRootProps) {
    const [sigCfg, setSigCfg] = createSignal({
        useVirtualEventBinding: true
    });
    const [sigMuteAutoPopIn, setSigMuteAutoPopin] = createSignal(false);

    const solidGoldenFactory = new SolidGoldenFactory();
    solidGoldenFactory.setJsxComponents(props.jsxComponents);
    const solidGoldenComponentRef = solidGoldenFactory.create("solid view");

    let _layoutElement: HTMLElement;
    let goldenLayoutRef: GoldenLayout;
    // let _goldenLayoutBoundingClientRect: DOMRect = new DOMRect();
    let _goldenLayoutBoundingClientRect: DOMRect = {
        "x": 0,
        "y": 0,
        "width": 0,
        "height": 0,
        "top": 0,
        "right": 0,
        "bottom": 0,
        "left": 0,
        toJSON: () => { }
    };
    const portalRefs: Record<string, HTMLDivElement> = {};

    const _boundComponentMap = new Map<ComponentContainer, ComponentBase>();
    const [sigBoundComponentCounter, setSigBoundComponentCounter] = createSignal(0);
    // const [sigBoundComponentById, setSigBoundComponentById] = createSignal<Record<string, ComponentBase>>({});
    // const [sigBoundComponentArray, setSigBoundComponentArray] = createSignal<[]{id: string, component: ComponentBase}>([]);
    const [boundComponents, setBoundComponents] = createStore<Record<string, {
        id: string,
        component: ComponentBase,
        rootElement: HTMLElement
    }>>({});
    const [sigMemorizedContainerStyle, setSigMemorizedContainerStyle] = createSignal<Record<string, any>>({});
    const [sigMemorizedRectMap, setSigMemorizedRectMap] = createSignal(new Map());
    const [sigLayoutElement, setSigLayoutElement] = createSignal<HTMLElement>();

    const fnNumberToPixels = (value: number): string => {
        return value.toString(10) + 'px';
    }

    const fnGoldenUtilSavedLayoutAdapter = (obj: any): any => {
        if (Array.isArray(obj)) {
            return obj.map((item) => fnGoldenUtilSavedLayoutAdapter(item));
        }

        if (obj !== null && typeof obj === 'object') {
            const newObj: GenericObject = {};
            const keys = Object.keys(obj);

            for (const key of keys) {
                if (key.endsWith('Unit')) continue;

                const unitKey = `${key}Unit`;

                if (Object.prototype.hasOwnProperty.call(obj, unitKey)) {
                    const value = obj[key];
                    const unit = obj[unitKey];

                    if (typeof value === 'number' && typeof unit === 'string') {
                        newObj[key] = `${value}${unit}`;
                    } else {
                        newObj[key] = value;
                    }
                } else {
                    newObj[key] = fnGoldenUtilSavedLayoutAdapter(obj[key]);
                }
            }
            return newObj;
        }
        return obj;
    }

    const fnGoldenListenEvents = <K extends keyof EventEmitter.EventParamsMap>(e: K, cb: EventEmitter.Callback<K>) => {
        goldenLayoutRef.on(e, cb);
    }

    const fnGoldenRegisterEventHub = (e: string, cb: EventEmitter.Callback<keyof EventEmitter.EventParamsMap>, goldenLayoutMgrRef?: GoldenLayout | LayoutManager) => {
        const gl: LayoutManager | GoldenLayout = goldenLayoutMgrRef ? goldenLayoutMgrRef : goldenLayoutRef;
        gl.eventHub.on(e as keyof EventEmitter.EventParamsMap, cb);
        console.log("Event Registered", gl);
    }

    const fnGoldenEmitEventHub = (eventName: string, value: string, goldenLayoutMgrRef?: GoldenLayout | LayoutManager) => {
        const gl: LayoutManager | GoldenLayout = goldenLayoutMgrRef ? goldenLayoutMgrRef : goldenLayoutRef;
        gl.eventHub.emit(eventName as keyof EventEmitter.EventParamsMap, value);
    }

    const fnHandleUnbindComponentEvent = (container: ComponentContainer) => {
        const component = _boundComponentMap.get(container);
        if (component === undefined) {
            throw new Error('handleUnbindComponentEvent: Component not found');
        }

        const componentRootElement = component.rootHtmlElement;
        if (componentRootElement === undefined) {
            throw new Error('handleUnbindComponentEvent: Component does not have a root HTML element');
        }

        if (container.virtual) {
            _layoutElement!.removeChild(componentRootElement);
        } else {
            // If embedded, then component handles unbinding of component elements from content.element
        }
        console.log("[GL] Unbinding Component", container);
        _boundComponentMap.delete(container);
        setSigBoundComponentCounter(sigBoundComponentCounter() - 1);
    }

    const fnHandleUnbindComponentEventV2 = (container: ComponentContainer) => {
        const component = _boundComponentMap.get(container);
        if (component === undefined) {
            throw new Error('handleUnbindComponentEvent: Component not found');
        }

        const componentRootElement = component.rootHtmlElement;
        if (componentRootElement === undefined) {
            throw new Error('handleUnbindComponentEvent: Component does not have a root HTML element');
        }

        if (container.virtual) {
            _layoutElement!.removeChild(componentRootElement);
        } else {
            // If embedded, then component handles unbinding of component elements from content.element
        }
        console.log("[GL] Unbinding Component", container);
        _boundComponentMap.delete(container);
        setSigBoundComponentCounter(sigBoundComponentCounter() - 1);
    }

    const _fnUnbindComponentEventListener = (container: ComponentContainer) => fnHandleUnbindComponentEvent(container);

    const fnGoldenInformComponentCreation = (c: ComponentContainer) => {
        console.log("[GL] Inform component creation", c);
        // if (this.componentContainersCb) {
        //     this.componentContainersCb(c);
        // }
        // else {
        //     console.log("Unable to inform component creation. Perhaps is popout?", c)
        // }
    }

    const fnCreateComponent = (container: ComponentContainer, componentTypeName: string, state: JsonValue | undefined, virtual: boolean) => {
        console.log("[GL] Masuk sini", container, componentTypeName, state, virtual);
        switch (componentTypeName) {
            case ColorComponent.typeName: return new ColorComponent(container, state, virtual);
            case TextComponent.typeName: return new TextComponent(container, state, virtual);
            case BooleanComponent.typeName: return new BooleanComponent(container, state, virtual);
            case EventComponent.typeName: return new EventComponent(container, state, virtual);
            case solidGoldenComponentRef.typeName: console.log("[GL] Case Sini"); fnGoldenInformComponentCreation(container); return new solidGoldenComponentRef(container, state, virtual);
            default:
                throw new Error('createComponent: Unexpected componentTypeName: ' + componentTypeName);
        }
    }

    const fnHandleContainerVirtualRectingRequiredEvent = (container: ComponentContainer, width: number, height: number) => {
        const component = _boundComponentMap.get(container);
        if (component === undefined) {
            throw new Error('handleContainerVirtualRectingRequiredEvent: Component not found');
        }

        const rootElement = component.rootHtmlElement;
        if (rootElement === undefined) {
            throw new Error('handleContainerVirtualRectingRequiredEvent: Component does not have a root HTML element');
        }

        const containerBoundingClientRect = (container.element as HTMLElement).getBoundingClientRect();
        const left = containerBoundingClientRect.left - _goldenLayoutBoundingClientRect.left;
        rootElement.style.left = fnNumberToPixels(left);
        const top = containerBoundingClientRect.top - _goldenLayoutBoundingClientRect.top;
        rootElement.style.top = fnNumberToPixels(top);
        rootElement.style.width = fnNumberToPixels(width);
        rootElement.style.height = fnNumberToPixels(height);
        const id = (component.container as any)._config.id
        // console.log("Component inst", component, sigMemorizedContainerStyle());
        setSigMemorizedContainerStyle({ ...sigMemorizedContainerStyle(), [id]: { ...rootElement.style } });
    }

    const fnHandleContainerVirtualVisibilityChangeRequiredEvent = (container: ComponentContainer, visible: boolean) => {
        const component = _boundComponentMap.get(container);
        if (component === undefined) {
            throw new Error('handleContainerVisibilityChangeRequiredEvent: Component not found');
        }

        const componentRootElement = component.rootHtmlElement;
        if (componentRootElement === undefined) {
            throw new Error('handleContainerVisibilityChangeRequiredEvent: Component does not have a root HTML element');
        }

        if (visible) {
            componentRootElement.style.display = '';
        } else {
            componentRootElement.style.display = 'none';
        }

        const id = (component.container as any)._config.id;
        setSigMemorizedContainerStyle({ ...sigMemorizedContainerStyle(), [id]: { ...componentRootElement.style } });
    }

    const fnHandleContainerVirtualZIndexChangeRequiredEvent = (container: ComponentContainer, logicalZIndex: LogicalZIndex, defaultZIndex: string) => {
        const component = _boundComponentMap.get(container);
        if (component === undefined) {
            throw new Error('handleContainerVirtualZIndexChangeRequiredEvent: Component not found');
        }

        const componentRootElement = component.rootHtmlElement;
        if (componentRootElement === undefined) {
            throw new Error('handleContainerVirtualZIndexChangeRequiredEvent: Component does not have a root HTML element');
        }

        componentRootElement.style.zIndex = defaultZIndex;
        const id = (component.container as any)._config.id;
        // console.log("Component inst", component, sigMemorizedContainerStyle());
        setSigMemorizedContainerStyle({ ...sigMemorizedContainerStyle(), [id]: { ...componentRootElement.style } });
    }

    const fnTemporarilyMuteAutoPopin = () => {
        setSigMuteAutoPopin(true);
        console.log("[GL Patch] Mute Auto Popin is", sigMuteAutoPopIn());
        setTimeout(() => {
            setSigMuteAutoPopin(false);
            console.log("[GL Patch] Mute Auto Popin is", sigMuteAutoPopIn());
        }, 500);
    }

    const fnHandleBindComponentEvent = (container: ComponentContainer, itemConfig: ResolvedComponentItemConfig): /* ComponentContainer.Handle */ any => {
        // TODO: Implementation unfinished
        console.log("[GL] Bind Listener", container, itemConfig);
        fnTemporarilyMuteAutoPopin();
        const componentTypeName = ResolvedComponentItemConfig.resolveComponentTypeName(itemConfig);
        if (componentTypeName === undefined) {
            throw new Error('handleBindComponentEvent: Undefined componentTypeName');
        }
        const component = fnCreateComponent(container, componentTypeName, itemConfig.componentState, sigCfg().useVirtualEventBinding);
        console.log("[GL] Built Component", container, component);
        _boundComponentMap.set(container, component);
        const id = itemConfig.id; // ID unik yang konsisten
        if (boundComponents[id]) {
            setBoundComponents(id, 'component', component);
            setBoundComponents(id, 'rootElement', component.rootHtmlElement);
            console.log("IT GOES HERE", id);
        } else {
            // JIKA BARU: Tambahkan ke store
            setBoundComponents(id, {
                id,
                component: component,
                rootElement: component.rootHtmlElement
            });
            setSigBoundComponentCounter(c => c + 1);
        }
        // setSigBoundComponentCounter(sigBoundComponentCounter() + 1);
        if (sigCfg().useVirtualEventBinding) {
            const componentRootElement = component.rootHtmlElement;
            _layoutElement.appendChild(componentRootElement);
            container.virtualRectingRequiredEvent = (container, width, height) => fnHandleContainerVirtualRectingRequiredEvent(container, width, height);
            container.virtualVisibilityChangeRequiredEvent = (container, visible) => fnHandleContainerVirtualVisibilityChangeRequiredEvent(container, visible);
            container.virtualZIndexChangeRequiredEvent = (container, logicalZIndex, defaultZIndex) => fnHandleContainerVirtualZIndexChangeRequiredEvent(container, logicalZIndex, defaultZIndex);
            return {
                component,
                virtual: true,
            }
        }
        else {
            return {
                component,
                virtual: false,
            }
        }

    }

    const _bindComponentEventListener =
        (container: ComponentContainer, itemConfig: ResolvedComponentItemConfig) => fnHandleBindComponentEvent(container, itemConfig);

    const fnHandleStackHeaderClick = (event: EventEmitter.ClickBubblingEvent) => {
        const stack = event.target as Stack;
        const itemCount = stack.contentItems.length;
        console.log("[GL] Stack header clicked. Item count: " + itemCount + " Stack: ", stack);
    }

    const fnHandleBeforeResizingEvent = (count: number) => {
        _goldenLayoutBoundingClientRect = _layoutElement.getBoundingClientRect();
        // this._lastVirtualRectingCount = count;
        // this._lastVirtualRectingCountSpan.innerText = this._lastVirtualRectingCount.toString();
        console.log("[GL] handleBeforeResizingEvent", count);
    }

    const fnHandleContainerInit = (container: any) => {
        _layoutElement = container;
        setSigLayoutElement(container);
        console.log("Container created", container);
        const _goldenLayout = new GoldenLayout(container, _bindComponentEventListener, _fnUnbindComponentEventListener);
        goldenLayoutRef = _goldenLayout;
        _goldenLayout.resizeWithContainerAutomatically = true;
        (_goldenLayout as any).beforeResizingEvent = (count: any) => fnHandleBeforeResizingEvent(count);
        _goldenLayout.addEventListener('stackHeaderClick', (event) => fnHandleStackHeaderClick(event));
        // const miniRowLayout: Layout = {
        //     name: 'miniRow',
        //     config: miniRowConfig,
        // };

        if (_goldenLayout.isSubWindow) {
            console.log("[GL] Treated as subwindow");
            _goldenLayout.checkAddDefaultPopinButton();

            // const subWindowUsesRegistrationBindings = false; // change to true if you want to test sub windows with registration bindings
            // if (subWindowUsesRegistrationBindings) {
            //     this.registerComponentTypes();
            // }
        }

        fnGoldenListenEvents("windowClosed", (a) => {
            console.log("[GoldLayout] Event Received", a);
        });

        fnGoldenListenEvents("beforeItemDestroyed", (b: any) => {
            const rect = b.target.element.getBoundingClientRect();
            setSigMemorizedRectMap(new Map(sigMemorizedRectMap().set(b.target.id, rect)));
            console.log("[GoldLayout] Rect before destroyed", sigMemorizedRectMap(), b);
        })

        // layout memorizer
        fnGoldenListenEvents("stateChanged" as any, (obj: any) => {
            // should be muted when popout occur    
            let state = goldenLayoutRef.saveLayout();
            let adapted = fnGoldenUtilSavedLayoutAdapter(state);
            console.log("[GL Evt] State Changed", state, adapted, obj, goldenLayoutRef);
        });

        fnGoldenListenEvents("stackCreated" as any, (a, b) => {
            console.log("[GoldLayout] Stack Created", a, b);
        });

        // const isPopup = _goldenLayout.isSubWindow;
        const isPopup = window.location.search.includes("gl-window");
        if (isPopup) {
            console.log("[GL] Treated as popup");
            (window).addEventListener("pagehide", (e) => { fnGoldenEmitEventHub("tabrestore", "Restore_" + window.location.search) }) // --> reliable
        }
        else {
            const layouts = prefinedLayouts.allComponents;
            const miniRowLayout = layouts.find((layout: any) => layout.name === 'miniRow');
            console.log("Predefined Layouts: ", layouts, "Selected miniRowLayout: ", miniRowLayout, _goldenLayout);
            setTimeout(() => {
                // SSR Unsafe Section
                _goldenLayout.loadLayout(miniRowLayout!.config);
                console.log("[GL] _boundComponentMap", _boundComponentMap);
            }, 0);

            console.log("[GL] Treated as main window");
            const recentlyPopInIds = [""];
            fnGoldenListenEvents("windowOpened", (bwPopout) => {
                console.log("[GoldLayout] Event Popout Received", bwPopout);
                const eName: string = "tabrestore";
                fnGoldenRegisterEventHub(
                    eName,
                    ((c: string, d) => {
                        // d is undefined
                        console.log("[EV] triggered child side!", c, d);
                        if (recentlyPopInIds.includes(c)) {

                        }
                        else {
                            setTimeout(() => {
                                let idx = recentlyPopInIds.indexOf(c);
                                let counter = 0;
                                console.log("[GL] Popin decision", recentlyPopInIds);
                                while (idx > -1) {
                                    counter++;
                                    recentlyPopInIds.splice(idx, 1);
                                    idx = recentlyPopInIds.indexOf(c);
                                }
                                if (counter > 1) {
                                    // bwPopout.popIn();
                                }
                                else {
                                    if (!sigMuteAutoPopIn()) {
                                        console.log("[GL] Assume popin done via forced ways (close window, change url, etc)", recentlyPopInIds, c);
                                        bwPopout.popIn();
                                    }
                                    else {
                                        console.log("[GL] Assume popin done via GL popIn element button (perform No-Op)", recentlyPopInIds, c);
                                    }
                                }
                            }, 100);
                        }
                        recentlyPopInIds.push(c);
                    }) as EventEmitter.Callback<"userBroadcast">,
                    bwPopout.getGlInstance()
                );
            });
        }
    }

    const fnCollectPortalRef = (portalEl: HTMLDivElement, cid: string) => {
        portalRefs[cid] = portalEl;
        onCleanup(() => {
            delete portalRefs[cid];
        });
    };

    createRenderEffect(() => {
        const styles = sigMemorizedContainerStyle();

        for (const id in portalRefs) {
            const el = portalRefs[id];
            const style = styles[id];

            if (el && style) {
                Object.assign(el.style, {
                    width: style.width,
                    height: style.height,
                    left: style.left,
                    top: style.top,
                    zIndex: style.zIndex,
                    position: 'absolute' // Biasanya dibutuhkan jika mengatur top/left
                });
            }
        }
    });

    onMount(() => {

    });

    return (
        <>
            <section class="bodySection">
                {/* C : {sigBoundComponentCounter()}, Ct : {_boundComponentMap.size} */}
                {// well, it actually more than just ComponentBase (see solidgolden-wrapper-component.ts)
                }
                {/* <For each={(sigBoundComponentCounter(), Array.from(_boundComponentMap.values()))}>
                    {(g, sigIdx) => {
                        const c = g as ComponentBase; 
                        return (
                            <Show when={sigIdx() > -1} fallback={<></>}>
                                <Show when={c}>
                                    <Portal mount={c.rootHtmlElement}>
                                        <GoldenComponentWrapper
                                            currentIndex={(c as any).state.jsxIndex}
                                            maxIndex={props.jsxComponents.length}
                                            jsxComponents={props.jsxComponents}
                                            state={(c as any).state}
                                        />
                                    </Portal>
                                </Show>
                            </Show>
                        )
                    }}
                </For> */}
                <For each={Object.values(boundComponents)}>
                    {(item) => {
                        const c = item.component;
                        const cid = (c.container as any)._config.id;
                        const isIframe = (c as any).state.jsxPreservationMode == "static-host";
                        return (
                            <Show when={item.rootElement && sigLayoutElement()}>
                                <Show when={isIframe} fallback={
                                    <Portal mount={item.rootElement}>
                                        <GoldenComponentWrapper
                                            currentIndex={(c as any).state.jsxIndex}
                                            maxIndex={props.jsxComponents.length}
                                            jsxComponents={props.jsxComponents}
                                            state={(c as any).state}
                                            glContainerRef={c.container}
                                        />
                                    </Portal>
                                }>
                                    {/* <Portal mount={sigLayoutElement()} ref={(el) => fnCollectPortalRef(el, cid)}> */}
                                        <div class="sjx-static-host" style={{
                                            width: sigMemorizedContainerStyle()[cid]?.width,
                                            height: sigMemorizedContainerStyle()[cid]?.height,
                                            left: sigMemorizedContainerStyle()[cid]?.left,
                                            top: sigMemorizedContainerStyle()[cid]?.top,
                                            "z-index": sigMemorizedContainerStyle()[cid]?.zIndex == "auto" ? "1" : sigMemorizedContainerStyle()[cid]?.zIndex,
                                            display: sigMemorizedContainerStyle()[cid]?.display,
                                        }}>
                                            <GoldenComponentWrapper
                                                currentIndex={(c as any).state.jsxIndex}
                                                maxIndex={props.jsxComponents.length}
                                                jsxComponents={props.jsxComponents}
                                                state={(c as any).state}
                                                glContainerRef={c.container}
                                            />
                                        </div>
                                    {/* </Portal> */}
                                </Show>
                            </Show>
                        )
                    }}
                </For>
                <section class="layoutContainer w-full h-96" ref={fnHandleContainerInit}>
                </section>
            </section>
        </>
    )
}