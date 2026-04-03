import { generateConversationTitle } from '@onlook/ai/src/agents/titles';
import {
    conversationInsertSchema,
    conversations,
    conversationUpdateSchema,
    fromDbConversation
} from '@onlook/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { createTRPCRouter, protectedProcedure } from '../../trpc';

export const conversationRouter = createTRPCRouter({
    getAll: protectedProcedure
        .input(z.object({ projectId: z.string() }))
        .query(async ({ ctx, input }) => {
            const dbConversations = await ctx.db.query.conversations.findMany({
                where: eq(conversations.projectId, input.projectId),
                orderBy: (conversations, { desc }) => [desc(conversations.updatedAt)],
            });
            return dbConversations.map((conversation) => fromDbConversation(conversation));
        }),
    get: protectedProcedure
        .input(z.object({ conversationId: z.string() }))
        .query(async ({ ctx, input }) => {
            const conversation = await ctx.db.query.conversations.findFirst({
                where: eq(conversations.id, input.conversationId),
            });
            if (!conversation) {
                throw new Error('Conversation not found');
            }
            return fromDbConversation(conversation);
        }),
    upsert: protectedProcedure
        .input(conversationInsertSchema)
        .mutation(async ({ ctx, input }) => {
            const [conversation] = await ctx.db.insert(conversations).values(input).returning();
            if (!conversation) {
                throw new Error('Conversation not created');
            }
            return fromDbConversation(conversation);
        }),
    update: protectedProcedure
        .input(conversationUpdateSchema)
        .mutation(async ({ ctx, input }) => {
            const [conversation] = await ctx.db.update({
                ...conversations,
                updatedAt: new Date(),
            }).set(input)
                .where(eq(conversations.id, input.id)).returning();
            if (!conversation) {
                throw new Error('Conversation not updated');
            }
            return fromDbConversation(conversation);
        }),
    delete: protectedProcedure
        .input(z.object({
            conversationId: z.string()
        }))
        .mutation(async ({ ctx, input }) => {
            await ctx.db.delete(conversations).where(eq(conversations.id, input.conversationId));
        }),
    generateTitle: protectedProcedure
        .input(z.object({
            conversationId: z.string(),
            content: z.string(),
        }))
        .mutation(async ({ ctx, input }) => {
            const MAX_NAME_LENGTH = 50;
            const generatedName = await generateConversationTitle(input.content);

            if (generatedName && generatedName.length > 0 && generatedName.length <= MAX_NAME_LENGTH) {
                await ctx.db.update(conversations).set({
                    displayName: generatedName,
                }).where(eq(conversations.id, input.conversationId));
                return generatedName;
            }

            console.error('Error generating conversation title');
            return null;
        }),
});
