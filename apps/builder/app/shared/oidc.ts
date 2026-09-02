import { z } from "zod";

// GoTrue /user response schema - matches actual API response
export const GoTrueUserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  user_metadata: z
    .object({
      name: z.string().optional(),
      picture: z.string().url().optional(),
      avatar_url: z.string().url().optional(),
      full_name: z.string().optional(),
    })
    .passthrough()
    .default({}),
  app_metadata: z
    .object({
      provider: z.string().optional(),
      providers: z.array(z.string()).optional(),
    })
    .passthrough()
    .optional(),
});

export type GoTrueUser = z.infer<typeof GoTrueUserSchema>;
