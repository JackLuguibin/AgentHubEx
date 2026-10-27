import { describe, expect, it } from "vitest";
import { buildCredentialOptions } from "./credential-options.js";

const user = {
  id: "11111111-1111-4111-8111-111111111111",
  label: "个人 Key",
  provider: "anthropic" as const,
  status: "active",
};

const project = {
  id: "22222222-2222-4222-8222-222222222222",
  label: "项目 Key",
  provider: "openai" as const,
  status: "active",
  isDefault: true,
  allowedRoles: ["owner", "developer"],
};

describe("credential options", () => {
  it("prefers the project default when policy allows both", () => {
    const result = buildCredentialOptions({
      policy: "user_or_project",
      role: "developer",
      canUseProject: true,
      userCredentials: [user],
      projectCredentials: [project],
    });
    expect(result.options).toHaveLength(2);
    expect(result.defaultChoice).toEqual({ source: "project", id: project.id });
  });

  it("hides project credentials under user_only and when the role is excluded", () => {
    const userOnly = buildCredentialOptions({
      policy: "user_only",
      role: "developer",
      canUseProject: true,
      userCredentials: [user],
      projectCredentials: [project],
    });
    expect(userOnly.options.map((item) => item.source)).toEqual(["user"]);
    expect(userOnly.defaultChoice).toEqual({ source: "user", id: user.id });

    const viewer = buildCredentialOptions({
      policy: "project_only",
      role: "viewer",
      canUseProject: false,
      userCredentials: [user],
      projectCredentials: [project],
    });
    expect(viewer.options).toEqual([]);
    expect(viewer.defaultChoice).toBeNull();
  });
});
