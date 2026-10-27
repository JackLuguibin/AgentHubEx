import { describe, expect, it } from "vitest";
import { credentialSourceAllowed } from "./credential-policy.js";

describe("credentialPolicy", () => {
  it("rejects the source the project forbids", () => {
    expect(credentialSourceAllowed("project_only", "user")).toBe(false);
    expect(credentialSourceAllowed("project_only", "project")).toBe(true);
    expect(credentialSourceAllowed("user_only", "project")).toBe(false);
    expect(credentialSourceAllowed("user_only", "user")).toBe(true);
    expect(credentialSourceAllowed("user_or_project", "user")).toBe(true);
    expect(credentialSourceAllowed("user_or_project", "project")).toBe(true);
  });
});
