import { Component, onMount } from "solid-js";
import { App } from "~/shared/components/golden-layout/app";
import { ComponentBase } from "~/shared/components/golden-layout/component-base";

import "./../shared/styles/golden-layout.css";
import "golden-layout/dist/css/goldenlayout-base.css";
import "golden-layout/dist/css/themes/goldenlayout-light-theme.css";
import Counter from "./Counter";
import { useSJXContext } from "~/shared/context/SJXContext";

export const GoldenLayoutView: Component<any> = () => {
    const cmpBase = ComponentBase;
    let app: App;
    const SJXctx = useSJXContext();
    onMount(() => {
        console.log("Loaded", cmpBase);
        app = new App(
            [
                <div>Hallo Dunia</div>,
                <h2>Apa Kabar {SJXctx?.ctx.increments.val()}</h2>,
                <p>Hey Brohhh</p>
                // <Counter />,
                // <Counter />,
                // <Counter />
            ]
        );
        (window as any).goldenLayoutApiTestApp = app;
        app.start();
    });

    const fnAddView = (index: number, title: string) => () => {
        app.goldenAppendView(index, title);
    }

    return (
        <>
        <button type="button" onclick={fnAddView(0, "View 1")}>Tambah View 1 cnt={SJXctx?.ctx.increments.val()}</button>
        <button type="button" onclick={fnAddView(1, "View 2")}>Tambah View 2</button>
        <button type="button" onclick={fnAddView(2, "View Brohh")}>Tambah View 3</button>
        <section id="bodySection">
            <section id="controls">
                <section id="registerSection">
                    <section id="registerNotVirtualSection">
                        <button id="registerNotVirtualButton" class="control" >Register Component Types</button>
                        <section id="registerNotVirtualRadioSection" class="radioLine">
                            <section class="labelledRadio">
                                <input id="registerNotVirtualAllRadio" class="control" type="radio" name="registerNotVirtualRadio" />
                                    <label for="registerNotVirtualAllRadio">All</label>
                            </section>
                            <section class="labelledRadio">
                                <input id="registerNotVirtualColorEventRadio" class="control" type="radio" name="registerNotVirtualRadio" checked />
                                    <label for="registerVirtualColorEventRadio">Color, Event</label>
                            </section>
                        </section>
                    </section>
                    <section id="registerVirtualSection">
                        <button id="registerVirtualButton" class="control">Register Component Types As Virtual</button>
                        <section id="registerVirtualRadioSection" class="radioLine">
                            <section class="labelledRadio">
                                <input id="registerVirtualAllRadio" type="radio" name="registerVirtualRadio" />
                                    <label for="registerVirtualAllRadio">All</label>
                            </section>
                            <section class="labelledRadio">
                                <input id="registerVirtualTextBooleanRadio" type="radio" name="registerVirtualRadio" checked />
                                    <label for="registerVirtualTextBooleanRadio">Text, Boolean</label>
                            </section>
                        </section>
                    </section>
                </section>
                <section id="eventBindingSection">
                    <span id="eventBindingSpan" title="Layout will be cleared">Event Binding:</span>
                    <section id="eventBindingRadios" class="radioLine">
                        <section class="labelledRadio">
                            <input id="eventBindingVirtualRadio" class="control" type="radio" name="eventBindingRadio" title="Layout will be cleared" />
                                <label for="eventBindingVirtualRadio">Virtual</label>
                        </section>
                        <section class="labelledRadio">
                            <input id="eventBindingEmbeddedRadio" class="control" type="radio" name="eventBindingRadio" title="Layout will be cleared" />
                                <label for="eventBindingEmbeddedRadio">Embedded</label>
                        </section>
                    </section>
                </section>
                <section id="clearSection">
                    <button id="clearButton" class="control">Clear</button>
                </section>
                <section id="predefinedLayoutsSection">
                    <select id="layoutSelect" class="control"></select>
                    <button id="loadLayoutButton" class="control">Load Layout</button>
                </section>
                <section id="saveAndReloadLayoutSection">
                    <button id="saveLayoutButton" class="control">Save Layout</button>
                    <button id="reloadSavedLayoutButton" class="control">Reload saved Layout</button>
                </section>
                <section id="addComponentSection">
                    <select id="registeredComponentTypesForAddSelect" class="control"></select>
                    <button id="addComponentByDragButton" class="control">D</button>
                    <button id="addComponentButton" class="control">Add Component</button>
                </section>
                <section id="rootComponentSection">
                    <button id="loadComponentAsRootButton" class="control">Load Component as Root</button>
                </section>
                <section id="replaceComponentSection">
                    <select id="registeredComponentTypesForReplaceSelect" class="control"></select>
                    <button id="replaceComponentButton" class="control">Replace Color Component with</button>
                </section>
                <section id="lastVirtualRectingCountSection">
                    <span>Last virtual recting count</span>
                    <span id="lastVirtualRectingCountSpan"></span>
                </section>
                <section id="clickCount">
                    <span>Click count: Capture: </span>
                    <span id="captureClickCountSpan"></span>
                    <span> Bubble: </span>
                    <span id="bubbleClickCountSpan"></span>
                </section>
                <section id="stackHeaderClick">
                    <span>Stack Header: </span>
                    <div id="stackHeaderClickedDiv">
                        <span>Clicked: </span>
                        <span id="stackHeaderClickedItemCountSpan"></span>
                    </div>
                </section>
            </section>
            <section id="layoutContainer">
            </section>
        </section>
        </>
    );
};