import { z } from "zod";
import { TimestampSchema, UuidSchema } from "./api.js";

export const CommonSyncPolicySchema = z.enum(["on_workspace_start", "on_common_publish"]);

export const CommonEntrySchema = z.object({
  path: z.string(),
  name: z.string(),
  isDir: z.boolean(),
  size: z.number().int().nonnegative(),
  mime: z.string().optional(),
  checksum: z.string().optional(),
  version: z.number().int().nonnegative(),
  protected: z.boolean(),
  updatedBy: z.object({
    id: UuidSchema,
    displayName: z.string(),
  }),
  updatedAt: TimestampSchema,
});

export const CommonTreeSchema = z.object({
  entries: z.array(CommonEntrySchema),
  usedBytes: z.number().int().nonnegative(),
  quotaBytes: z.number().int().positive(),
  syncPolicy: CommonSyncPolicySchema,
  protectedPrefixes: z.array(z.string()),
  canWrite: z.boolean(),
  canWriteProtected: z.boolean(),
});

export const CommonSettingsSchema = z.object({
  quotaBytes: z.number().int().positive(),
  usedBytes: z.number().int().nonnegative(),
  protectedPrefixes: z.array(z.string()),
  syncPolicy: CommonSyncPolicySchema,
});

export const PutCommonSettingsSchema = z.object({
  quotaBytes: z.number().int().positive().max(100 * 1024 * 1024 * 1024).optional(),
  protectedPrefixes: z.array(z.string().min(1)).max(50).optional(),
  syncPolicy: CommonSyncPolicySchema.optional(),
});

export const CreateCommonDirSchema = z.object({
  path: z.string().min(1),
});

export const MoveCommonFileSchema = z.object({
  moveTo: z.string().min(1),
});

export const RestoreCommonVersionSchema = z.object({
  version: z.number().int().positive(),
});

export const CommonVersionSchema = z.object({
  version: z.number().int().positive(),
  size: z.number().int().nonnegative(),
  checksum: z.string(),
  createdBy: UuidSchema,
  createdAt: TimestampSchema,
});

export type CommonEntry = z.infer<typeof CommonEntrySchema>;
export type CommonTree = z.infer<typeof CommonTreeSchema>;
export type CommonSettings = z.infer<typeof CommonSettingsSchema>;
export type CommonVersion = z.infer<typeof CommonVersionSchema>;
