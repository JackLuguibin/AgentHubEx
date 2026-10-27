import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildContainerCreateOptions } from "./container-spec.js";
import { FakeDocker } from "./docker.js";
import { createNodeApp } from "./app.js";
import { packTar, unpackTar } from "./tar.js";

describe("worker container spec", () => {
  it("drops privileges and refuses the docker socket", () => {
    const spec = buildContainerCreateOptions({
      workspaceId: "11111111-1111-4111-8111-111111111111",
      tenantId: "22222222-2222-4222-8222-222222222222",
      projectId: "33333333-3333-4333-8333-333333333333",
      userId: "44444444-4444-4444-8444-444444444444",
      image: "agenthub/worker-opencode",
      resources: { cpu: 2, memMb: 4096, diskGb: 20 },
      bootToken: "boot-token-value",
      volumePath: "/var/lib/agenthub/ws",
      commonPath: "/var/lib/agenthub/common",
      bindIp: "127.0.0.1",
    });
    const encoded = JSON.stringify(spec);
    expect(encoded).not.toContain("docker.sock");
    expect(spec.Image).toBe("agenthub/worker-opencode");
    expect(spec.User).toBe("10001:10001");
    expect(spec.HostConfig.CapDrop).toEqual(["ALL"]);
    expect(spec.HostConfig.SecurityOpt).toContain("no-new-privileges:true");
    expect(spec.HostConfig.NetworkMode).toBe("agenthub-ws");
    expect(spec.HostConfig.PidsLimit).toBe(1024);
    expect(spec.HostConfig.Binds[1]).toMatch(/:\/project-common:ro$/);
    expect(spec.HostConfig.PortBindings["4096/tcp"]?.[0]?.HostIp).toBe("127.0.0.1");
    expect(spec.Env.some((item) => item.startsWith("BOOT_TOKEN="))).toBe(true);
  });

  it("rejects a non-worker image", () => {
    expect(() =>
      buildContainerCreateOptions({
        workspaceId: "11111111-1111-4111-8111-111111111111",
        tenantId: "22222222-2222-4222-8222-222222222222",
        projectId: "33333333-3333-4333-8333-333333333333",
        userId: "44444444-4444-4444-8444-444444444444",
        image: "alpine:latest",
        resources: { cpu: 1, memMb: 512, diskGb: 1 },
        bootToken: "boot-token-value",
        volumePath: "/tmp/ws",
        commonPath: "/tmp/common",
        bindIp: "127.0.0.1",
      }),
    ).toThrow(/refusing image/);
  });
});

describe("node agent API", () => {
  it("creates a workspace, writes files, and stops the container", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agenthub-node-"));
    const docker = new FakeDocker({ cpu: 4, memMb: 8192, diskGb: 40, maxWorkspaces: 2 });
    const { app } = createNodeApp({
      docker,
      capacity: { cpu: 4, memMb: 8192, diskGb: 40, maxWorkspaces: 2 },
      workspaceRoot: path.join(root, "ws"),
      commonRoot: path.join(root, "common"),
      bindIp: "127.0.0.1",
      agentVersion: "0.1.0",
      fetchImpl: async () => new Response("spec-body"),
    });
    const id = "55555555-5555-4555-8555-555555555555";
    const created = await app.request("/workspaces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: id,
        tenantId: "22222222-2222-4222-8222-222222222222",
        projectId: "33333333-3333-4333-8333-333333333333",
        userId: "44444444-4444-4444-8444-444444444444",
        runtimeType: "opencode",
        image: "agenthub/worker-opencode",
        resources: { cpu: 2, memMb: 4096, diskGb: 20 },
        bootToken: "boot-token-value",
      }),
    });
    expect(created.status).toBe(201);
    const body = await created.json();
    expect(body.endpoint).toBe(`mock://managed/${id}`);
    expect(JSON.stringify(docker.inspect(id)?.options)).not.toContain("docker.sock");

    const tar = packTar([{ path: "AGENTS.md", content: Buffer.from("# hello") }]);
    expect(unpackTar(tar)[0]?.content.toString()).toBe("# hello");
    const applied = await app.request(`/workspaces/${id}/files/apply`, {
      method: "POST",
      headers: { "content-type": "application/x-tar" },
      body: tar,
    });
    expect(applied.status).toBe(200);

    const synced = await app.request(`/workspaces/${id}/common/sync`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "http://files.internal/spec.md", path: "docs/spec.md" }),
    });
    expect(synced.status).toBe(200);

    const stopped = await app.request(`/workspaces/${id}/stop`, { method: "POST" });
    expect(stopped.status).toBe(200);
    expect(docker.inspect(id)?.state).toBe("stopped");
  });
});
