import { makeAutoObservable } from 'mobx';

import type { CodeFileSystem } from '@onlook/file-system';
import { type Branch } from '@onlook/models';
import type { PostHog } from 'posthog-js/react';
import { ActionManager } from './action';
import { ApiManager } from './api';
import { AstManager } from './ast';
import { BranchManager } from './branch';
import { CanvasManager } from './canvas';
import { ChatManager } from './chat';
import { CodeManager } from './code';
import { CopyManager } from './copy';
import { ElementsManager } from './element';
import { FontManager } from './font';
import { FrameEventManager } from './frame-events';
import { FramesManager } from './frames';
import { GroupManager } from './group';
import { IdeManager } from './ide';
import { ImageManager } from './image';
import { InsertManager } from './insert';
import { MoveManager } from './move';
import { OverlayManager } from './overlay';
import { PagesManager } from './pages';
import { type SandboxManager } from './sandbox';
import { ScreenshotManager } from './screenshot';
import { SnapManager } from './snap';
import { StateManager } from './state';
import { StyleManager } from './style';
import { TextEditingManager } from './text';
import { ThemeManager } from './theme';
import { TweaksManager } from './tweaks';

export class EditorEngine {
    readonly projectId: string;
    readonly posthog: PostHog;
    readonly branches: BranchManager;
    readonly state: StateManager;
    readonly canvas: CanvasManager;
    readonly text: TextEditingManager;
    readonly elements: ElementsManager;
    readonly overlay: OverlayManager;
    readonly insert: InsertManager;
    readonly move: MoveManager;
    readonly copy: CopyManager;
    readonly group: GroupManager;
    readonly ast: AstManager;
    readonly action: ActionManager;
    readonly style: StyleManager;
    readonly code: CodeManager;
    readonly chat: ChatManager;
    readonly image: ImageManager;
    readonly theme: ThemeManager;
    readonly font: FontManager;
    readonly pages: PagesManager;
    readonly frames: FramesManager;
    readonly frameEvent: FrameEventManager;
    readonly screenshot: ScreenshotManager;
    readonly snap: SnapManager;
    readonly api: ApiManager;
    readonly ide: IdeManager;
    readonly tweaks: TweaksManager;

    constructor(projectId: string, posthog: PostHog) {
        this.projectId = projectId;
        this.posthog = posthog;

        this.branches = new BranchManager(this);
        this.state = new StateManager();
        this.canvas = new CanvasManager(this);
        this.text = new TextEditingManager(this);
        this.elements = new ElementsManager(this);
        this.overlay = new OverlayManager(this);
        this.insert = new InsertManager(this);
        this.move = new MoveManager(this);
        this.copy = new CopyManager(this);
        this.group = new GroupManager(this);
        this.ast = new AstManager(this);
        this.action = new ActionManager(this);
        this.style = new StyleManager(this);
        this.code = new CodeManager(this);
        this.chat = new ChatManager(this);
        this.image = new ImageManager(this);
        this.theme = new ThemeManager(this);
        this.font = new FontManager(this);
        this.pages = new PagesManager(this);
        this.frames = new FramesManager(this);
        this.frameEvent = new FrameEventManager(this);
        this.screenshot = new ScreenshotManager(this);
        this.snap = new SnapManager(this);
        this.api = new ApiManager(this);
        this.ide = new IdeManager(this);
        this.tweaks = new TweaksManager(this);

        makeAutoObservable(this);
    }

    async init() {
        this.overlay.init();
        this.image.init();
        this.frameEvent.init();
        this.chat.init();
        this.style.init();
    }

    async initBranches(branches: Branch[]) {
        await this.branches.initBranches(branches);
        await this.branches.init();
    }

    clear() {
        this.elements.clear();
        this.frames.clear();
        this.action.clear();
        this.overlay.clear();
        this.ast.clear();
        this.text.clean();
        this.insert.clear();
        this.move.clear();
        this.style.clear();
        this.copy.clear();
        this.group.clear();
        this.canvas.clear();
        this.image.clear();
        this.theme.clear();
        this.font.clear();
        this.pages.clear();
        this.chat.clear();
        this.code.clear();
        this.tweaks.clear();
        this.branches.clear();
        this.frameEvent.clear();
        this.screenshot.clear();
        this.snap.hideSnapLines();
    }

    clearUI() {
        this.overlay.clearUI();
        this.elements.clear();
        this.frames.deselectAll();
        this.snap.hideSnapLines();
    }

    async refreshLayers() {
        for (const frame of this.frames.getAll()) {
            if (!frame.view) {
                console.error('No frame view found');
                continue;
            }
            await frame.view.processDom();
        }
    }
}
