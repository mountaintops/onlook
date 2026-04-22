import { makeAutoObservable } from 'mobx';
import { v4 as uuidv4 } from 'uuid';

export type PinCommentStatus = 'pending' | 'streaming' | 'done' | 'error';

export interface PinComment {
    id: string;
    /** Stable DOM identifier for the targeted element */
    elementDomId: string;
    /** Human-readable tag (e.g. "div", "button", "span") */
    elementTagName: string;
    /** The user's raw instruction text */
    instruction: string;
    /** Isolated conversation – each pin gets its own, never shared with the main chat */
    conversationId: string;
    projectId: string;
    status: PinCommentStatus;
    createdAt: Date;
}

/**
 * Manages pin comments attached to specific DOM elements.
 * Each comment spawns its own AI sub-agent (unique conversationId) that runs
 * in parallel with all others and with the main right-panel chat.
 */
export class PinCommentsManager {
    pinComments: Map<string, PinComment> = new Map();

    constructor() {
        makeAutoObservable(this);
    }

    /**
     * Create a new pin comment. Returns the newly created PinComment so the
     * caller can immediately start the AI sub-agent conversation.
     */
    addComment(params: {
        elementDomId: string;
        elementTagName: string;
        instruction: string;
        projectId: string;
    }): PinComment {
        const comment: PinComment = {
            id: uuidv4(),
            conversationId: uuidv4(),
            status: 'pending',
            createdAt: new Date(),
            ...params,
        };
        this.pinComments.set(comment.id, comment);
        return comment;
    }

    removeComment(id: string) {
        this.pinComments.delete(id);
    }

    setStatus(id: string, status: PinCommentStatus) {
        const comment = this.pinComments.get(id);
        if (comment) {
            comment.status = status;
        }
    }

    get all(): PinComment[] {
        return Array.from(this.pinComments.values()).sort(
            (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
        );
    }

    clear() {
        this.pinComments.clear();
    }
}
