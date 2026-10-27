export type CredentialPolicy = "user_or_project" | "project_only" | "user_only";
export type CredentialSource = "user" | "project";
export type ProjectRoleName = "owner" | "developer" | "viewer";

export type CredentialChoice = {
  source: CredentialSource;
  id: string;
  label: string;
  provider: "anthropic" | "openai" | "opencode" | "custom";
  isDefault: boolean;
};

type UserRow = {
  id: string;
  label: string;
  provider: CredentialChoice["provider"];
  status: string;
};

type ProjectRow = UserRow & {
  isDefault: boolean;
  allowedRoles: string[];
};

/** Options list + default, matching architecture 06.3 (no stored preference yet). */
export function buildCredentialOptions(input: {
  policy: CredentialPolicy;
  role: ProjectRoleName | null;
  canUseProject: boolean;
  userCredentials: UserRow[];
  projectCredentials: ProjectRow[];
}): {
  policy: CredentialPolicy;
  defaultChoice: { source: CredentialSource; id: string } | null;
  options: CredentialChoice[];
} {
  const options: CredentialChoice[] = [];

  if (input.policy !== "project_only") {
    for (const row of input.userCredentials) {
      if (row.status !== "active") continue;
      options.push({
        source: "user",
        id: row.id,
        label: row.label,
        provider: row.provider,
        isDefault: false,
      });
    }
  }

  if (input.policy !== "user_only" && input.canUseProject && input.role) {
    for (const row of input.projectCredentials) {
      if (row.status !== "active") continue;
      if (!row.allowedRoles.includes(input.role)) continue;
      options.push({
        source: "project",
        id: row.id,
        label: row.label,
        provider: row.provider,
        isDefault: row.isDefault,
      });
    }
  }

  const projectDefault =
    input.policy === "user_only"
      ? undefined
      : options.find((item) => item.source === "project" && item.isDefault);
  if (projectDefault) {
    return {
      policy: input.policy,
      defaultChoice: { source: projectDefault.source, id: projectDefault.id },
      options,
    };
  }

  const personal = options.filter((item) => item.source === "user");
  if (
    (input.policy === "user_only" || input.policy === "user_or_project") &&
    personal.length === 1
  ) {
    return {
      policy: input.policy,
      defaultChoice: { source: "user", id: personal[0]!.id },
      options,
    };
  }

  return { policy: input.policy, defaultChoice: null, options };
}
