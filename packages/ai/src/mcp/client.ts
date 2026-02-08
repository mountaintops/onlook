import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { tool as aiTool } from 'ai';
import { z } from 'zod';
import { convertJsonSchemaToZod } from 'zod-from-json-schema';

export class OnlookMCPClient {
    private client: Client | null = null;
    private transport: StdioClientTransport | null = null;

    constructor(private serverName: string, private serverVersion: string = '1.0.0') { }

    async connect(command: string, args: string[] = [], env?: Record<string, string>) {
        const rawEnv = { ...process.env, ...env };
        const filteredEnv = Object.fromEntries(
            Object.entries(rawEnv).filter(([_, v]) => v !== undefined)
        ) as Record<string, string>;

        this.transport = new StdioClientTransport({
            command,
            args,
            env: filteredEnv,
        });

        this.client = new Client(
            {
                name: this.serverName,
                version: this.serverVersion,
            },
            {
                capabilities: {},
            }
        );

        await this.client.connect(this.transport);
    }

    async getTools() {
        if (!this.client) {
            throw new Error('MCP Client not connected');
        }

        const { tools: mcpTools } = await this.client.listTools();
        const aiTools: Record<string, any> = {};

        for (const tool of mcpTools) {
            aiTools[tool.name] = aiTool({
                description: tool.description,
                // Using inputSchema as per BaseTool implementation in this codebase
                inputSchema: convertJsonSchemaToZod(tool.inputSchema as any) as z.ZodType<any>,
                execute: async (args: any) => {
                    if (!this.client) {
                        throw new Error('MCP Client not connected');
                    }
                    const result = await this.client.callTool({
                        name: tool.name,
                        arguments: args,
                    });

                    if (result.isError) {
                        const content = (result.content as any[]).map(c => c.type === 'text' ? c.text : '').join('\n');
                        throw new Error(content);
                    }

                    return (result.content as any[]).map(c => {
                        if (c.type === 'text') return c.text;
                        if (c.type === 'image') return '[Image]';
                        if (c.type === 'resource') return `[Resource: ${c.resource.uri}]`;
                        return '';
                    }).join('\n');
                },
            });
        }

        return aiTools;
    }

    async disconnect() {
        if (this.client) {
            await this.client.close();
            this.client = null;
        }
    }
}
