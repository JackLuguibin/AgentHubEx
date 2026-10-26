import { describe, expect, it } from "vitest";
import { can, effectiveProjectRole, roleHasPermission } from "./rbac.js";
import { hashPassword, verifyPassword } from "./password.js";
import { signAccessToken, verifyAccessToken } from "./jwt.js";
import { randomUUID } from "node:crypto";

describe("RBAC matrix (03.4)", () => {
  it("viewer cannot create sessions", () => {
    expect(can("viewer", "member", "session.create")).toBe(false);
    expect(can("viewer", "member", "project.read")).toBe(true);
  });

  it("developer can session + issue.write but not config.manage", () => {
    expect(can("developer", "member", "session.create")).toBe(true);
    expect(can("developer", "member", "issue.write")).toBe(true);
    expect(can("developer", "member", "config.manage")).toBe(false);
  });

  it("project.owner has audit_meta and member.manage", () => {
    expect(can("owner", "member", "session.audit_meta")).toBe(true);
    expect(can("owner", "member", "member.manage")).toBe(true);
  });

  it("tenant.admin is project.owner on management surface (ADR-014)", () => {
    expect(effectiveProjectRole(null, "admin")).toBe("owner");
    expect(can(null, "admin", "config.apply")).toBe(true);
    expect(can(null, "admin", "session.create", { managementSurface: false })).toBe(false);
  });

  it("tenant.member without project membership cannot act", () => {
    expect(can(null, "member", "project.read")).toBe(false);
  });

  it("node.manage is platform.admin only", () => {
    expect(can("owner", "owner", "node.manage")).toBe(false);
    expect(can("owner", "owner", "node.manage", { isPlatformAdmin: true })).toBe(true);
  });

  it("instance.manage for tenant.admin or platform.admin", () => {
    expect(can("owner", "member", "instance.manage")).toBe(false);
    expect(can(null, "admin", "instance.manage")).toBe(true);
  });

  it("roleHasPermission matches owner supersets", () => {
    expect(roleHasPermission("owner", "common.write_protected")).toBe(true);
    expect(roleHasPermission("developer", "common.write_protected")).toBe(false);
  });
});

describe("password + JWT", () => {
  it("hashes and verifies argon2id", async () => {
    const h = await hashPassword("correct-horse-battery");
    expect(await verifyPassword(h, "correct-horse-battery")).toBe(true);
    expect(await verifyPassword(h, "wrong")).toBe(false);
  });

  it("signs and verifies access JWT claims", async () => {
    const secret = "test-secret";
    const token = await signAccessToken(
      {
        sub: randomUUID(),
        tid: randomUUID(),
        troles: ["admin"],
        pa: false,
        jti: randomUUID(),
      },
      secret,
    );
    const payload = await verifyAccessToken(token, secret);
    expect(payload.troles).toEqual(["admin"]);
    expect(payload.pa).toBe(false);
  });
});
