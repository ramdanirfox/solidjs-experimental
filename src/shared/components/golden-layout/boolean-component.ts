import { ComponentContainer, JsonValue } from 'golden-layout';
import { ComponentBase } from './component-base';
import Counter from '~/components/Counter';
import { render } from 'solid-js/web';

export class BooleanComponent extends ComponentBase {
    static readonly typeName = 'boolean';

    private _inputElement: HTMLInputElement;

    private _containerClickListener = () => this.handleClickFocusEvent();
    private _containerFocusinListener = () => this.handleClickFocusEvent();

    constructor(container: ComponentContainer, state: JsonValue | undefined, virtual: boolean) {
        super(container, virtual);

        this._inputElement = document.createElement('input');
        this._inputElement.type = "checkbox";
        this._inputElement.checked = (state as boolean) ?? true;
        this._inputElement.style.display = "block";

        this.rootHtmlElement.appendChild(this._inputElement);
        // const a = () => <Counter />;
        
        render(() => Counter(), this.rootHtmlElement);

        this.container.stateRequestEvent = () => this.handleContainerStateRequestEvent();

        this.rootHtmlElement.addEventListener('click', this._containerClickListener);
        this.rootHtmlElement.addEventListener('focusin', this._containerFocusinListener);
    }

    handleContainerStateRequestEvent(): boolean {
        return this._inputElement.checked;
    }

    private handleClickFocusEvent(): void {
        this.container.focus();
    }
}
