import { makeAutoObservable } from 'mobx';
import stripAnsi from 'strip-ansi';

import { SUPPORT_EMAIL } from '@onlook/constants';
import { type GitCommit } from '@onlook/git';

import type { SandboxManager } from '../sandbox';
import { prepareCommitMessage, sanitizeCommitMessage, withSyncPaused } from '@/utils/git';

export const ONLOOK_DISPLAY_NAME_NOTE_REF = 'refs/notes/onlook-display-name';

export interface GitStatus {
    files: string[];
}

export interface GitCommandResult {
    success: boolean;
    output: string;
    error: string | null;
}

export class GitManager {
    commits: GitCommit[] | null = null;
    isLoadingCommits = false;

    constructor(private sandbox: SandboxManager) {
        makeAutoObservable(this);
    }

    /**
     * Initialize git manager - auto-initializes repo if needed and preloads commits
     */
    async init(): Promise<void> {
        const isInitialized = await this.isRepoInitialized();
        if (!isInitialized) {
            await this.initRepo();
        }
        await this.listCommits();
    }

    /**
     * Check if git repository is initialized
     */
    async isRepoInitialized(): Promise<boolean> {
        try {
            // ALWAYS use git rev-parse as the source of truth
            // .git might exist in the sandbox but be hidden from the file system sync engine
            const statusResult = await this.runCommand('git rev-parse --is-inside-work-tree', true);
            if (statusResult.success && statusResult.output.trim() === 'true') {
                return true;
            }
            return false;
        } catch (error) {
            console.error('[GitManager] Error checking if repository is initialized:', error);
            return false;
        }
    }

    /**
     * Ensure git config is set with default values if not already configured
     */
    async ensureGitConfig(): Promise<boolean> {
        try {
            if (!this.sandbox.session) {
                console.error('[GitManager] No sandbox session available for config');
                return false;
            }

            // Check if user.name is set
            const nameResult = await this.runCommand('git config user.name', true);
            const emailResult = await this.runCommand('git config user.email', true);

            const hasName = nameResult.success && nameResult.output.trim();
            const hasEmail = emailResult.success && emailResult.output.trim();

            // If both are already set, no need to configure
            if (hasName && hasEmail) {
                return true;
            }

            console.log('[GitManager] Configuring git user for the first time...');

            // Set user.name if not configured
            if (!hasName) {
                const nameConfigResult = await this.runCommand('git config --global user.name "Onlook"');
                if (!nameConfigResult.success) {
                    console.error('[GitManager] Failed to set git user.name:', nameConfigResult.error);
                }
            }

            // Set user.email if not configured
            if (!hasEmail) {
                const emailConfigResult = await this.runCommand(
                    `git config --global user.email "${SUPPORT_EMAIL}"`,
                );
                if (!emailConfigResult.success) {
                    console.error('[GitManager] Failed to set git user.email:', emailConfigResult.error);
                }
            }

            return true;
        } catch (error) {
            console.error('[GitManager] Failed to ensure git config:', error);
            return false;
        }
    }

    /**
     * Initialize git repository
     */
    async initRepo(): Promise<boolean> {
        try {
            const isInitialized = await this.isRepoInitialized();
            if (isInitialized) {
                console.log('Repository already initialized');
                return true;
            }

            if (!this.sandbox.session) {
                console.error('No sandbox session available');
                return false;
            }

            console.log('Initializing git repository...');

            // Initialize git repository
            const initResult = await this.runCommand('git init');
            if (!initResult.success) {
                console.error('Failed to initialize git repository:', initResult.error);
                return false;
            }

            // Configure git user (required for commits)
            await this.ensureGitConfig();

            // Set default branch to main
            await this.runCommand('git branch -M main');

            console.log('Git repository initialized successfully');
            return true;
        } catch (error) {
            console.error('Failed to initialize git repository:', error);
            return false;
        }
    }

    /**
     * Get repository status
     */
    async getStatus(): Promise<GitStatus | null> {
        try {
            const status = await this.sandbox.session.provider?.gitStatus({});
            if (!status) {
                console.error('Failed to get git status');
                return null;
            }

            return {
                files: Object.keys(status.changedFiles || {}),
            };
        } catch (error) {
            console.error('Failed to get git status:', error);
            return null;
        }
    }

    /**
     * Stage all files
     */
    async stageAll(): Promise<GitCommandResult> {
        return this.runCommand('git add .');
    }

    /**
     * Create a commit (low-level) - auto-refreshes commits after successful commit
     */
    async commit(message: string): Promise<GitCommandResult> {
        const sanitizedMessage = sanitizeCommitMessage(message);
        const escapedMessage = prepareCommitMessage(sanitizedMessage);
        
        console.log(`[GitManager] Attempting to commit: "${sanitizedMessage.substring(0, 50)}..."`);
        
        const result = await this.runCommand(
            `git commit --allow-empty --no-verify -m ${escapedMessage}`,
        );

        if (result.success) {
            console.log('[GitManager] Commit successful, waiting for filesystem to settle...');
            // Wait a tiny bit for git state to settle
            await new Promise((resolve) => setTimeout(resolve, 200));
            await this.listCommits();
        } else {
            console.error('[GitManager] Commit failed:', result.error);
        }
        return result;
    }

    /**
     * Create a commit (high-level) - handles full flow: stage, config, commit
     */
    async createCommit(message = 'New Onlook backup'): Promise<GitCommandResult> {
        const status = await this.getStatus();

        // Stage all files
        const addResult = await this.stageAll();
        if (!addResult.success) {
            return addResult;
        }

        // Ensure git config
        await this.ensureGitConfig();

        // Create the commit
        return await this.commit(message);
    }

    /**
     * List commits with formatted output - stores results in this.commits
     */
    async listCommits(maxRetries = 2): Promise<GitCommit[]> {
        this.isLoadingCommits = true;
        let lastError: Error | null = null;

        try {
            // Check if repo exists first to avoid unnecessary errors
            const isInit = await this.isRepoInitialized();
            if (!isInit) {
                console.log('[GitManager] Repo not initialized, skipping listCommits');
                this.commits = [];
                return [];
            }

            for (let attempt = 0; attempt <= maxRetries; attempt++) {
                try {
                    // Do NOT use ignoreError: true here, we need the actual error message in result.error
                    const result = await this.runCommand(
                        'git --no-pager log --pretty=format:"COMMIT_START%n%H%n%an <%ae>%n%ad%n%B%nCOMMIT_END" --date=iso',
                    );

                    if (result.success && result.output) {
                        const parsedCommits = this.parseGitLog(result.output);
                        
                        console.log(`[GitManager] Successfully listed ${parsedCommits.length} commits`);

                        // Enhance commits with display names from notes
                        if (parsedCommits.length > 0) {
            const enhancedCommits = await Promise.all(
                                parsedCommits.map(async (commit) => {
                                    const displayName = await this.getCommitNote(commit.oid);
                                    return {
                                        ...commit,
                                        displayName: displayName || commit.message,
                                    };
                                }),
                            );
                            this.commits = enhancedCommits;
                            return enhancedCommits;
                        }

                        this.commits = parsedCommits;
                        return parsedCommits;
                    }

                    // If it's a new repo with no commits, this is expected
                    const errorStr = result.error || '';
                    if (errorStr.includes('does not have any commits yet') || 
                        errorStr.includes('fatal: bad default revision \'HEAD\'')) {
                        console.log('[GitManager] Repository is empty (no commits yet)');
                        this.commits = [];
                        return [];
                    }

                    console.warn(`[GitManager] listCommits failed (attempt ${attempt + 1}):`, result.error);
                    lastError = new Error(`Git command failed: ${result.error || 'Unknown error'}`);

                    if (attempt < maxRetries) {
                        await new Promise((resolve) =>
                            setTimeout(resolve, Math.pow(2, attempt) * 300),
                        );
                        continue;
                    }

                    this.commits = [];
                    return [];
                } catch (error) {
                    lastError = error instanceof Error ? error : new Error(String(error));
                    console.warn(
                        `Attempt ${attempt + 1} failed to list commits:`,
                        lastError.message,
                    );

                    if (attempt < maxRetries) {
                        // Wait before retry with exponential backoff
                        await new Promise((resolve) =>
                            setTimeout(resolve, Math.pow(2, attempt) * 200),
                        );
                        continue;
                    }

                    console.error('All attempts failed to list commits', lastError);
                    this.commits = [];
                    return [];
                }
            }

            this.commits = [];
            return [];
        } finally {
            this.isLoadingCommits = false;
        }
    }

    /**
     * Checkout/restore to a specific commit - auto-refreshes commits after restore
     */
    async restoreToCommit(commitOid: string): Promise<GitCommandResult> {
        const result = await withSyncPaused(
            this.sandbox.syncEngine,
            () => {
                return this.runCommand(`git restore --source ${commitOid} .`);
            },
            async () => {
                const status = await this.getStatus();
                return status?.files;
            },
            2000, // Increase settle delay for large restores
        );

        if (result.success) {
            await this.listCommits();
        }

        return result;
    }

    /**
     * Add a display name note to a commit - updates commit in local cache
     */
    async addCommitNote(commitOid: string, displayName: string): Promise<GitCommandResult> {
        const sanitizedDisplayName = sanitizeCommitMessage(displayName);
        const escapedDisplayName = prepareCommitMessage(sanitizedDisplayName);
        const result = await this.runCommand(
            `git --no-pager notes --ref=${ONLOOK_DISPLAY_NAME_NOTE_REF} add -f -m ${escapedDisplayName} ${commitOid}`,
        );

        if (result.success && this.commits) {
            // Update the commit in local cache instead of re-fetching all commits
            const commitIndex = this.commits.findIndex((commit) => commit.oid === commitOid);
            if (commitIndex !== -1) {
                this.commits[commitIndex]!.displayName = sanitizedDisplayName;
            }
        }

        return result;
    }

    /**
     * Get display name from commit notes
     */
    async getCommitNote(commitOid: string): Promise<string | null> {
        try {
            const result = await this.runCommand(
                `git --no-pager notes --ref=${ONLOOK_DISPLAY_NAME_NOTE_REF} show ${commitOid}`,
                true,
            );
            if (result.success && result.output) {
                const cleanOutput = this.formatGitLogOutput(result.output);
                return cleanOutput || null;
            }
            return null;
        } catch (error) {
            console.warn('Failed to get commit note', error);
            return null;
        }
    }

    /**
     * Run a git command through the sandbox session
     */
    private runCommand(command: string, ignoreError = false): Promise<GitCommandResult> {
        return this.sandbox.session.runCommand(command, undefined, ignoreError);
    }

    private parseGitLog(rawOutput: string): GitCommit[] {
        const cleanOutput = this.formatGitLogOutput(rawOutput);

        if (!cleanOutput) {
            console.warn('[GitManager] Empty clean output from git log');
            return [];
        }

        const commits: GitCommit[] = [];

        // Split by COMMIT_START and COMMIT_END markers
        const commitBlocks = cleanOutput.split('COMMIT_START').filter((block) => block.trim());

        console.log(`[GitManager] Parsing git log: found ${commitBlocks.length} blocks. Raw output length: ${rawOutput.length}`);

        for (const block of commitBlocks) {
            try {
                // Remove the end marker and any trailing whitespace
                const cleanBlock = block.replace(/COMMIT_END\s*$/, '').trim();
                
                // We need the raw lines to properly join the message, but we need to find where the header ends
                const rawLines = cleanBlock.split('\n');
                const headerLines = rawLines.map(l => l.trim()).filter(l => l.length > 0);

                if (headerLines.length < 3) {
                    console.warn('[GitManager] skipping block, too few headers:', headerLines.length, cleanBlock.substring(0, 100));
                    continue;
                }

                // The first 3 non-empty lines are always hash, author, date
                const hash = headerLines[0];
                const authorLine = headerLines[1];
                const dateLine = headerLines[2];

                // Message starts after the date. We find the date in rawLines and take everything after.
                const dateIndex = rawLines.findIndex(l => l.trim() === dateLine);
                const message = rawLines.slice(dateIndex + 1).join('\n').trim();

                if (!hash || !authorLine || !dateLine) {
                    console.warn('[GitManager] Missing required fields in block:', { hash, authorLine, dateLine });
                    continue;
                }

                // Parse author name and email
                const authorMatch = /^(.+?)\s*<(.+?)>$/.exec(authorLine);
                const authorName = authorMatch?.[1]?.trim() || authorLine;
                const authorEmail = authorMatch?.[2]?.trim() || '';

                // Parse date to timestamp
                let timestamp: number;
                try {
                    timestamp = Math.floor(new Date(dateLine).getTime() / 1000);
                    if (isNaN(timestamp) || timestamp < 0) {
                        timestamp = Math.floor(Date.now() / 1000);
                    }
                } catch (error) {
                    console.warn('[GitManager] Failed to parse commit date:', dateLine, error);
                    timestamp = Math.floor(Date.now() / 1000);
                }

                const displayMessage = message.split('\n')[0] || 'No message';

                commits.push({
                    oid: hash,
                    message: message || 'No message',
                    author: {
                        name: authorName,
                        email: authorEmail,
                    },
                    timestamp: timestamp,
                    displayName: displayMessage,
                });
            } catch (error) {
                console.error('[GitManager] Error parsing commit block:', error, block.substring(0, 100));
            }
        }

        console.log(`[GitManager] Successfully parsed ${commits.length} commits`);
        return commits;
    }

    private formatGitLogOutput(input: string): string {
        // Use strip-ansi library for robust ANSI escape sequence removal
        let cleanOutput = stripAnsi(input);

        // Remove any remaining control characters except newline and tab
        cleanOutput = cleanOutput.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

        // Remove null bytes
        cleanOutput = cleanOutput.replace(/\0/g, '');

        return cleanOutput.trim();
    }
}
