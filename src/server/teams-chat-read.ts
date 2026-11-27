import { z } from 'zod';

const chatMessages = z.strictObject({
  connectionId: z.uuid(),
  chat_id: z
    .string()
    .min(1)
    .max(256)
    .regex(/^[a-zA-Z0-9:@._-]+$/),
  user_id: z.literal('me').optional(),
  top: z.number().int().min(1).max(50).optional(),
});

export function teamsChatRead(action: string, args: Record<string, unknown>) {
  if (action !== 'MICROSOFT_TEAMS_LIST_USER_CHAT_MESSAGES') return;
  const parsed = chatMessages.safeParse(args);
  if (parsed.success) return parsed.data;
}
