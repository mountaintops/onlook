import type { Change, DomElement, StyleChange } from "@onlook/models";
import { getElementByDomId } from "../elements";
import { cssManager } from "./css-manager";

export function updateStyle(domId: string, change: Change<Record<string, StyleChange>>): DomElement | null {
    cssManager.updateStyle(domId, change.updated);
    const domEl = getElementByDomId(domId, true);
    if (domEl && domEl.styles) {
        for (const [prop, val] of Object.entries(change.updated)) {
            domEl.styles.computed[prop] = val.value;
            domEl.styles.defined[prop] = val.value;
        }
    }
    return domEl;
}
