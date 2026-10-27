/** Worker egress policy for intranet / airgap (architecture 18.3 and 05 §5.8). */

export const CLOUD_METADATA_IP = "169.254.169.254";

export type DeployProfile = "intranet" | "airgap" | "internet-lab";

export type EgressPolicy = {
  profile: DeployProfile;
  defaultDenyPublic: boolean;
  deny: string[];
  allow: string[];
};

export function parseEgressAllowlist(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function workerEgressPolicy(input: {
  profile: DeployProfile;
  allowlist?: string[];
  controlPlaneCidr?: string;
}): EgressPolicy {
  const deny = [CLOUD_METADATA_IP];
  if (input.controlPlaneCidr) deny.push(input.controlPlaneCidr);
  if (input.profile === "internet-lab") {
    return { profile: input.profile, defaultDenyPublic: false, deny, allow: [] };
  }
  return {
    profile: input.profile,
    defaultDenyPublic: true,
    deny,
    allow: input.allowlist ?? [],
  };
}
