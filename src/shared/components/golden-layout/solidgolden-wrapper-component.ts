import { ComponentContainer, JsonValue } from 'golden-layout';
import { ComponentBase } from './component-base';
import Counter from '~/components/Counter';
import { render } from 'solid-js/web';
import { JSX } from 'solid-js';

export class SolidGoldenWrapperComponent extends ComponentBase {
    static readonly typeName = 'solidgolden_wrapper';

    // private _inputElement: HTMLInputElement;

    private _containerClickListener = () => this.handleClickFocusEvent();
    private _containerFocusinListener = () => this.handleClickFocusEvent();

    constructor(container: ComponentContainer, state: JsonValue | undefined, virtual: boolean, jsxComponents: JSX.Element[]) {
        super(container, virtual);

        // this._inputElement = document.createElement('input');
        // this._inputElement.type = "checkbox";
        // this._inputElement.checked = (state as boolean) ?? true;
        // this._inputElement.style.display = "block";

        // this.rootHtmlElement.appendChild(this._inputElement);
        // const a = () => <Counter />;
        console.log("[SJSWrapper] State : ", state);
        if (state && typeof (state as any).jsxIndex == "number" && jsxComponents[(state as any).jsxIndex]) {
            render(() => jsxComponents[(state as any).jsxIndex], this.rootHtmlElement);
        }
        else {
            render(() => Counter(), this.rootHtmlElement);
        }

        this.container.stateRequestEvent = () => this.handleContainerStateRequestEvent();

        this.rootHtmlElement.addEventListener('click', this._containerClickListener);
        this.rootHtmlElement.addEventListener('focusin', this._containerFocusinListener);
    }

    handleContainerStateRequestEvent(): boolean {
        // return this._inputElement.checked;
        return true;
    }

    private handleClickFocusEvent(): void {
        this.container.focus();
    }
}

import { createSignal } from 'solid-js';
import { GoldenComponentWrapper as GoldenComponentWrapper } from '~/components/GoldenComponentWrapper';

interface RegisteredClasses {
    [typeName: string]: any;
}

const [registeredClasses, setRegisteredClasses] = createSignal<RegisteredClasses>({});

export class SolidGoldenFactory {
    constructor() {}
    public jsxComponents: (JSX.Element | (()=>JSX.Element))[] = [];

    private static defaultOptions: { typeName: string } = {
        typeName: 'solidgolden',
    };

    create(typeName: string) {
        if (!typeName || typeof typeName !== 'string') {
            throw new Error('Invalid typeName');
        }

        const existingClass = (registeredClasses as RegisteredClasses)[typeName];
        if (existingClass) {
            return new existingClass();
        }

        const options: { typeName: string } = { ...SolidGoldenFactory.defaultOptions, typeName };
        const jsxRef = this.jsxComponents; // dont use, only able to assigned once every create calls
        // console.log("[Factory] JSX Refs", this.jsxComponents, jsxRef);
        const newClass = class klass extends ComponentBase {
            static readonly typeName: string = options.typeName;
            static jsxCmps: (JSX.Element | (()=>JSX.Element))[] = [];

            private _containerClickListener = () => this.handleClickFocusEvent();
            private _containerFocusinListener = () => this.handleClickFocusEvent();
            state: JsonValue | undefined;
            constructor(container: ComponentContainer, state: JsonValue | undefined, virtual: boolean) {
                super(container, virtual);
                this.state = state;
                klass.jsxCmps = jsxRef;
                // this._inputElement = document.createElement('input');
                // this._inputElement.type = "checkbox";
                // this._inputElement.checked = (state as boolean) ?? true;
                // this._inputElement.style.display = "block";

                // this.rootHtmlElement.appendChild(this._inputElement);
                // const a = () => <Counter />;
                // console.trace("[SJSWrapper] State2 : ", state, klass.jsxCmps);
                // if (state && typeof (state as any).jsxIndex == "number" && klass.jsxCmps[(state as any).jsxIndex]) {
                //     render(() => klass.jsxCmps[(state as any).jsxIndex], this.rootHtmlElement);
                //     console.log("[SJSWrapper] root html", this.rootHtmlElement);
                // }
                // else {
                    render(() => GoldenComponentWrapper(
                        {
                            currentIndex: (state as any).jsxIndex,
                            maxIndex: klass.jsxCmps.length,
                            jsxComponents: klass.jsxCmps,
                            state: state
                        }), this.rootHtmlElement);
                    // render(() => Counter(), this.rootHtmlElement);
                // }

                this.container.stateRequestEvent = () => this.handleContainerStateRequestEvent();

                this.rootHtmlElement.addEventListener('click', this._containerClickListener);
                this.rootHtmlElement.addEventListener('focusin', this._containerFocusinListener);
            }

            handleContainerStateRequestEvent(): JsonValue | undefined {
                // return this._inputElement.checked;
                return this.state;
            }

            private handleClickFocusEvent(): void {
                this.container.focus();
            }

            updateJsxComponents(jsxComponents: (JSX.Element[] | (()=>JSX.Element))[]) {
                klass.jsxCmps = jsxComponents;
                // console.trace("[SJSWrapper] Updating JSX", jsxComponents, klass.jsxCmps);
            }
        };

        setRegisteredClasses({ ...registeredClasses, [typeName]: newClass });
        return newClass;
    }

    static register<T>(typeName: string, klass: { new(): T }): void {
        setRegisteredClasses({ ...registeredClasses, [typeName]: klass });
    }

    static unregister(typeName: string): void {
        const classes = registeredClasses;
        delete (classes as RegisteredClasses)[typeName];
        setRegisteredClasses(classes);
    }

    setJsxComponents(jsxComponents: (JSX.Element | (()=>JSX.Element))[]) {
        console.log("[Factory] Set JSX", jsxComponents);
        this.jsxComponents = jsxComponents;
        Object.keys(registeredClasses()).forEach((typeName) => {
            const klassRef = registeredClasses()[typeName];
            klassRef.prototype.updateJsxComponents(jsxComponents);
        })
    }
}