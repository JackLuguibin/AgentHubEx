import { z } from "zod";

export const TenantStatusSchema = z.enum(["active", "suspended"]);
export const TenantRoleSchema = z.enum(["owner", "admin", "member"]);
export const ProjectRoleSchema = z.enum(["owner", "developer", "viewer"]);
export const CredentialPolicySchema = z.enum(["user_or_project", "project_only", "user_only"]);
export const RuntimeTypeSchema = z.enum(["opencode", "claude"]);

export const TenantSchema = z.object({
  id: z.string().uuid(),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,38}$/),
  name: z.string().min(1),
  status: TenantStatusSchema,
});

export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string().min(1),
  handle: z.string().regex(/^[a-z0-9-]+$/),
  isPlatformAdmin: z.boolean(),
  status: z.enum(["active", "disabled"]),
});

export const ProjectSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  key: z.string().regex(/^[A-Z][A-Z0-9]{1,9}$/),
  name: z.string().min(1),
  credentialPolicy: CredentialPolicySchema,
  archivedAt: z.string().datetime().nullable().optional(),
});

export type Tenant = z.infer<typeof TenantSchema>;
export type User = z.infer<typeof UserSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type TenantRole = z.infer<typeof TenantRoleSchema>;
export type ProjectRole = z.infer<typeof ProjectRoleSchema>;
export type RuntimeType = z.infer<typeof RuntimeTypeSchema>;
