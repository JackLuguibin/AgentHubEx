import { describe, expect, it } from "vitest";
import { encryptSecret } from "./crypto.js";
import { openSecret, rewrapSecret, sealWrapped, secretAad, unwrapTenantDek, wrapNewTenantDek } from "./envelope.js";
import { localKekFromEnv } from "./kek.js";

const platform = "dev-platform-dek-32bytes-minimum!!";
const aad = secretAad({ tenantId: "user", kind: "user", id: "cred-1", version: 1 });

describe("envelope encryption", () => {
  it("keeps legacy ciphertext readable and rejects a moved AAD", async () => {
    const kek = localKekFromEnv({ AGENTHUB_MASTER_KEY_V1: "master-key-version-one" }, platform);
    const legacy = encryptSecret("legacy-secret", platform);
    expect(await openSecret(legacy, { platformDek: platform, kek, aad })).toBe("legacy-secret");

    const sealed = await sealWrapped("sk-live-value", aad, kek);
    expect(await openSecret(sealed.blob, { platformDek: platform, kek, aad })).toBe("sk-live-value");
    await expect(
      openSecret(sealed.blob, { platformDek: platform, kek, aad: secretAad({ ...{ tenantId: "other", kind: "user", id: "cred-1", version: 1 } }) }),
    ).rejects.toThrow();
  });

  it("rotates the KEK wrap and then opens with only the new key", async () => {
    const oldRing = localKekFromEnv({ AGENTHUB_MASTER_KEY_V1: "master-key-version-one" }, platform);
    const sealed = await sealWrapped("sk-rotate", aad, oldRing);
    const window = localKekFromEnv(
      {
        AGENTHUB_MASTER_KEY_V1: "master-key-version-one",
        AGENTHUB_MASTER_KEY_V2: "master-key-version-two",
      },
      platform,
    );
    expect(window.currentVersion).toBe(2);
    const rotated = await rewrapSecret(sealed.blob, { platformDek: platform, kek: window, aad });
    expect(rotated.version).toBe(2);
    const next = localKekFromEnv({ AGENTHUB_MASTER_KEY_V2: "master-key-version-two" }, platform);
    expect(await openSecret(rotated.blob, { platformDek: platform, kek: next, aad })).toBe("sk-rotate");
    await expect(openSecret(rotated.blob, { platformDek: platform, kek: oldRing, aad })).rejects.toThrow();
  });

  it("wraps a tenant DEK without returning the KEK", async () => {
    const kek = localKekFromEnv({ AGENTHUB_MASTER_KEY: "master-key-current-value" }, platform);
    expect(() => kek.exportKey()).toThrow(/export is forbidden/);
    const wrapped = await wrapNewTenantDek(kek);
    const dek = await unwrapTenantDek(wrapped.blob, kek);
    expect(dek.equals(wrapped.dek)).toBe(true);
    dek.fill(0);
    wrapped.dek.fill(0);
  });
});
