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
