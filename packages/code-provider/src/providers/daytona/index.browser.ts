import { type DaytonaProviderOptions } from './index';

export class DaytonaProvider {
    constructor(options: DaytonaProviderOptions) {
        console.warn('DaytonaProvider is not supported in the browser. Using shim.');
    }

    async initialize(options: any): Promise<void> {
        throw new Error('DaytonaProvider is not supported in the browser.');
    }

    async getFiles(path: string): Promise<any[]> {
        throw new Error('DaytonaProvider is not supported in the browser.');
    }

    async readFile(path: string): Promise<string> {
        throw new Error('DaytonaProvider is not supported in the browser.');
    }

    async writeFile(path: string, content: string): Promise<void> {
        throw new Error('DaytonaProvider is not supported in the browser.');
    }

    async deleteFile(path: string): Promise<void> {
        throw new Error('DaytonaProvider is not supported in the browser.');
    }

    async runCommand(command: string): Promise<string> {
        throw new Error('DaytonaProvider is not supported in the browser.');
    }
}

export type { DaytonaProviderOptions };
