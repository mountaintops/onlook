import {
    MessageContextType,
    type ChatMessage,
    type MessageContext
} from '@onlook/models';
import type { FileUIPart } from 'ai';
import { AgentRuleContext, BranchContext, ErrorContext, FileContext, ImageContext } from '../contexts/classes';
import { ARCHITECT_MODE_SYSTEM_PROMPT, ASK_MODE_SYSTEM_PROMPT, CREATE_NEW_PAGE_SYSTEM_PROMPT, SHELL_PROMPT, SUGGESTION_SYSTEM_PROMPT, SUMMARY_PROMPTS, SYSTEM_PROMPT } from './constants';
import { wrapXml } from './helpers';

export interface HydrateMessageOptions {
    totalMessages: number;
    currentMessageIndex: number;
    lastUserMessageIndex: number;
    lastAssistantMessageIndex: number;
}

export function getSystemPrompt() {
    let prompt = '';
    prompt += wrapXml('role', SYSTEM_PROMPT);
    prompt += wrapXml('shell', SHELL_PROMPT);
    return prompt;
}

export function getCreatePageSystemPrompt() {
    let prompt = getSystemPrompt() + '\n\n';
    prompt += wrapXml('create-system-prompt', CREATE_NEW_PAGE_SYSTEM_PROMPT);
    return prompt;
}

export function getSuggestionSystemPrompt() {
    let prompt = '';
    prompt += wrapXml('role', SUGGESTION_SYSTEM_PROMPT);
    return prompt;
}

export function getAskModeSystemPrompt() {
    let prompt = '';
    prompt += wrapXml('role', ASK_MODE_SYSTEM_PROMPT);
    return prompt;
}

export function getArchitectModeSystemPrompt() {
    let prompt = getSystemPrompt() + '\n\n';
    prompt += wrapXml('architect-workflow', ARCHITECT_MODE_SYSTEM_PROMPT);
    return prompt;
}

export function getArchitectModeClassificationPrompt(content: string) {
    return `You are classifying a UI coding task by complexity. Reply with ONLY one word: "tools", "small", "medium", or "large".

TOOLS — task requires system operations (not UI coding):
- Creating folders or files, running terminal/bash/npm commands
- Git operations, MCP tool calls, installing packages, deploying

SMALL — minor edits to existing UI elements:
- Edit text, copy, labels, or placeholder content
- Change a color, font size, spacing, padding, margin
- Add or remove a line break, divider, or separator
- Show/hide an element or toggle visibility
- Fix a typo or adjust alignment
- Add a simple button, badge, tag, or icon
- Change a border radius, shadow, or opacity
- Adjust a single style property on an existing element

MEDIUM — creating or significantly reworking a self-contained section or component:
- Build a new reusable component (card, modal, form field, nav item)
- Redesign or remake an existing section (hero banner, footer, sidebar)
- Add a multi-field form or structured list
- Implement a responsive layout change for a section
- Add CSS/Tailwind animations to existing elements (hover effects, fade, slide)
- Add interactivity to an existing component (toggle, accordion, tabs)
- Create a new section within an existing page

LARGE — building entire pages or complex multi-part features from scratch:
- Create or completely remake a full page (landing page, dashboard, settings page, auth page)
- Build complex multi-step flows (onboarding wizard, checkout flow)
- Implement page-level transitions or route animations
- Design a full layout system with multiple regions
- Build a feature spanning multiple components and pages
- Create a full design system or theme overhaul

Task to classify: "${content}"
Reply with exactly one word.`;
}

export function getExampleConversation(
    conversation: {
        role: string;
        content: string;
    }[],
) {
    let prompt = '';
    for (const message of conversation) {
        prompt += `${message.role.toUpperCase()}: ${message.content}\n`;
    }
    return prompt;
}

export function getHydratedUserMessage(
    id: string,
    parts: ChatMessage['parts'],
    context: MessageContext[],
    opt: HydrateMessageOptions,
): ChatMessage {
    let userParts: ChatMessage['parts'] = [];
    const files = context.filter((c) => c.type === MessageContextType.FILE).map((c) => c);
    const highlights = context.filter((c) => c.type === MessageContextType.HIGHLIGHT).map((c) => c);
    const errors = context.filter((c) => c.type === MessageContextType.ERROR).map((c) => c);
    const agentRules = context.filter((c) => c.type === MessageContextType.AGENT_RULE).map((c) => c);
    const allImages = context.filter((c) => c.type === MessageContextType.IMAGE).map((c) => c);
    const externalImages = allImages.filter((img) => img.source === 'external');
    const localImages = allImages.filter((img) => img.source === 'local');
    const branches = context.filter((c) => c.type === MessageContextType.BRANCH).map((c) => c);

    // If there are 50 user messages in the contexts, we can trim all of them except
    // the last one. The logic could be adjusted to trim more or less messages.
    const truncateFileContext = opt.currentMessageIndex < opt.lastUserMessageIndex;
    // Should the code need to trim other types of contexts, it can be done here.

    let prompt = '';
    if (truncateFileContext) {
        const contextPrompt = FileContext.getTruncatedFilesContent(files);
        if (contextPrompt) {
            prompt += wrapXml('truncated-context', contextPrompt);
        }
    } else {
        const contextPrompt = FileContext.getFilesContent(files, highlights);
        if (contextPrompt) {
            prompt += contextPrompt + '\n';
        }
    }

    if (errors.length > 0) {
        const errorPrompt = ErrorContext.getErrorsContent(errors);
        prompt += errorPrompt;
    }

    if (agentRules.length > 0) {
        const agentRulePrompt = AgentRuleContext.getAgentRulesContent(agentRules);
        prompt += agentRulePrompt;
    }

    if (branches.length > 0) {
        const branchPrompt = BranchContext.getBranchesContent(branches);
        prompt += branchPrompt;
    }

    if (localImages.length > 0) {
        const localImageList = localImages
            .map((img) => `- ${img.displayName}: ${img.path} (branch: ${img.branchId})`)
            .join('\n');
        prompt += wrapXml('local-images',
            'These images already exist in the project at the specified paths. Reference them directly in your code without uploading:\n' + localImageList
        );
    }

    if (externalImages.length > 0) {
        const imageList = externalImages
            .map((img, idx) => `${idx + 1}. ${img.displayName} (ID: ${img.id || 'unknown'})`)
            .join('\n');
        prompt += wrapXml('available-images',
            'These are new images that need to be uploaded to the project using the upload_image tool:\n' + imageList
        );
    }

    const textContent = parts
        .filter((p) => p.type === 'text')
        .map((p) => p.text)
        .join('\n');
    prompt += wrapXml('instruction', textContent);

    userParts.push({ type: 'text', text: prompt });

    if (allImages.length > 0) {
        const fileParts: FileUIPart[] = ImageContext.toFileUIParts(allImages);
        userParts = userParts.concat(fileParts);
    }

    return {
        id,
        role: 'user',
        parts: userParts,
    };
}

export function getLanguageFromFilePath(filePath: string): string {
    return filePath.split('.').pop() ?? '';
}

export function getBranchContent(id: string) {
    return wrapXml('branch', `id: "${id}"`);
}

export function getSummaryPrompt() {
    let prompt = '';

    prompt += wrapXml('summary-rules', SUMMARY_PROMPTS.rules);
    prompt += wrapXml('summary-guidelines', SUMMARY_PROMPTS.guidelines);
    prompt += wrapXml('summary-format', SUMMARY_PROMPTS.format);
    prompt += wrapXml('summary-reminder', SUMMARY_PROMPTS.reminder);

    prompt += wrapXml('example-summary-output', 'EXAMPLE SUMMARY:\n' + SUMMARY_PROMPTS.summary);
    return prompt;
}

export function getGitCommitTitlePrompt(instruction: string) {
    return `Generate a concise, professional git commit title (max 50 characters) based on the user's intent. Do not include a period at the end. Use imperative mood (e.g. "Add feature" instead of "Added feature"). Return only the title text. User instruction: ${instruction}`;
}

export function getConversationTitlePrompt(content: string) {
    return `Generate a short, descriptive title (2-4 words) for this conversation based on the initial message. Return only the title text, nothing else. User message: ${content}`;
}
