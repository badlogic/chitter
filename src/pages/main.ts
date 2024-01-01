import { html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { Api } from "../api";
import { BaseElement, renderError } from "../app";
import { i18n } from "../utils/i18n";
import { speechBubbleIcon } from "../utils/icons";
import { pageContainerStyle, pageContentStyle } from "../utils/styles";

@customElement("main-page")
export class MainPage extends BaseElement {
    @property()
    isCreating = false;

    @property()
    error?: string;

    protected createRenderRoot(): Element | ShadowRoot {
        return this;
    }

    render() {
        if (this.isCreating)
            return html`<div class="${pageContainerStyle}">
                <div class="${pageContentStyle} items-center justify-center">
                    <h1 class="text-center mt-8 mb-8">chitter</h1>
                    <span>${i18n("Creating chat ...")}</span>
                    <loading-spinner class="mt-2"></loading-spinner>
                </div>
            </div>`;

        return html`<div class="${pageContainerStyle}">
            <div class="${pageContentStyle} items-center justify-center">
                <h1 class="text-center mt-8 mb-4 flex items-center gap-2"><i class="icon w-6 h-6">${speechBubbleIcon}</i><span>chitter</span></h1>
                <span class="text-sm italic mb-4">${i18n("Chat with family and friends")}</span>
                ${this.error ? html`<div class="w-full max-w-[320px]">${renderError(this.error)}</div>` : nothing}
                <div class="flex flex-col w-full max-w-[320px] mt-2">
                    <span class="text-xs text-muted-fg">${i18n("Chat name")}</span>
                    <input id="roomName" class="textfield" />
                    <span class="text-xs text-muted-fg mt-2">${i18n("User name")}</span>
                    <input id="userName" class="textfield" />
                    <div class="flex justify-center items-center gap-1 mt-2 cursor-pointer">
                        <input id="adminInviteOnly" type="checkbox" class="cursor-pointer" checked /><span
                            class="text-xs"
                            @click=${(ev: Event) =>
                                (this.querySelector<HTMLInputElement>("#adminInviteOnly")!.checked =
                                    !this.querySelector<HTMLInputElement>("#adminInviteOnly")!.checked)}
                            >${i18n("Only admins can invite")}</span
                        >
                    </div>
                    <button class="button" @click=${() => this.createChat()}>${i18n("Create chat")}</button>
                </div>
            </div>
        </div>`;
    }

    async createChat() {
        this.error = undefined;

        const roomName = this.querySelector<HTMLInputElement>("#roomName")?.value;
        if (!roomName) {
            this.error = i18n("Please specify a chat name");
            return;
        }

        const userName = this.querySelector<HTMLInputElement>("#userName")?.value;
        if (!userName) {
            this.error = i18n("Please specify a user name");
            return;
        }

        const adminInviteOnly = this.querySelector<HTMLInputElement>("#adminInviteOnly")?.checked ?? true;

        this.isCreating = true;
        try {
            const result = await Api.createRoomAndAdmin(roomName, userName, adminInviteOnly);
        } finally {
            this.isCreating = false;
        }
    }
}
