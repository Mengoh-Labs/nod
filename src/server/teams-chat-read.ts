import { z } from 'zod';

export const teamsMessagesAction = 'MICROSOFT_TEAMS_LIST_USER_CHAT_MESSAGES';

const chatMessages = z.strictObject({
  connectionId: z.uuid().optional(),
  chat_id: z
    .string()
    .min(1)
    .max(256)
    .regex(/^[a-zA-Z0-9:@._-]+$/),
  user_id: z.literal('me').optional(),
  top: z.number().int().min(1).max(50).optional(),
});

export function teamsChatRead(action: string, args: Record<string, unknown>) {
  if (action !== teamsMessagesAction) return;
  const parsed = chatMessages.safeParse(args);
  if (parsed.success) return parsed.data;
}

const chatReadAlias = chatMessages.omit({ top: true }).extend({
  limit: chatMessages.shape.top,
});

export function normalizeTeamsChatRead(action: string, args: Record<string, unknown>) {
  if (action !== 'microsoft_teams__get_chat_messages') return;
  const parsed = chatReadAlias.safeParse(args);
  if (!parsed.success)
    throw new Error(
      'No request was sent. Use apps with action SEARCH_TOOLS and args {query:"MICROSOFT_TEAMS_LIST_USER_CHAT_MESSAGES"} to get the supported arguments.',
    );
  const { limit, ...target } = parsed.data;
  return {
    action: teamsMessagesAction,
    args: { ...target, ...(limit === undefined ? {} : { top: limit }) },
  };
}
