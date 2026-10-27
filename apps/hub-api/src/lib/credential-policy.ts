export type CredentialPolicy = "user_or_project" | "project_only" | "user_only";
export type CredentialSource = "user" | "project";

/** Architecture 06.3: a source that conflicts with credentialPolicy is rejected. */
export function credentialSourceAllowed(
  policy: CredentialPolicy,
  source: CredentialSource,
): boolean {
  if (policy === "project_only" && source === "user") return false;
  if (policy === "user_only" && source === "project") return false;
  return true;
}
