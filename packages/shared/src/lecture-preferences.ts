import { z } from "zod";

export const lecturePreferencesSchema = z.object({
  model: z.enum(["balanced", "opus", "sonnet"]).default("balanced"),
  format: z.enum(["structured", "narrative"]).default("structured"),
  tone: z.enum(["plain", "friendly", "academic"]).default("plain"),
  detail: z.enum(["brief", "standard", "detailed"]).default("standard"),
}).strict();
export type LecturePreferences = z.infer<typeof lecturePreferencesSchema>;
export const DEFAULT_LECTURE_PREFERENCES: LecturePreferences = lecturePreferencesSchema.parse({});
