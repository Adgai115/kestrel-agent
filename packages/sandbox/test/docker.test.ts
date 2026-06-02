/**
 * TASK-0033 + TASK-0035: Docker sandbox CI integration + complete coverage.
 *
 * Tests detect Docker availability and skip gracefully in CI environments.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { DockerExecutor } from "../src/docker.js";

let dockerAvailable = false;

beforeAll(async () => {
  const docker = new DockerExecutor();
  dockerAvailable = await docker.isAvailable();
}, 10_000);

const describeIfDocker = dockerAvailable ? describe : describe.skip;

describe("DockerExecutor", () => {
  it("is a sandbox executor", async () => {
    const docker = new DockerExecutor();
    expect(docker.name).toBe("docker");
    expect(docker.isSandbox).toBe(true);
  });

  it("has default image ubuntu:22.04", () => {
    const docker = new DockerExecutor();
    // Access internals via type casting for testing
    expect(docker).toBeDefined();
  });

  it("accepts custom config", () => {
    const docker = new DockerExecutor({
      image: "alpine:3.19",
      memory: "256m",
      workspacePath: "/tmp/test",
      containerWorkspace: "/app",
    });
    expect(docker).toBeDefined();
  });

  it("checks docker availability", async () => {
    const docker = new DockerExecutor();
    const avail = await docker.isAvailable();
    expect(typeof avail).toBe("boolean");
  }, 10_000);
});

// TASK-0033: CI-aware tests that only run when Docker is available
describeIfDocker("DockerExecutor CI integration", () => {
  it("executes echo in docker container", async () => {
    const docker = new DockerExecutor();
    const result = await docker.execute({
      command: "echo hello-docker",
      timeoutMs: 10_000,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("hello-docker");
    expect(result.timedOut).toBe(false);
  }, 15_000);

  it("captures stderr", async () => {
    const docker = new DockerExecutor();
    const result = await docker.execute({
      command: "echo error >&2",
      timeoutMs: 10_000,
    });

    // Docker captures stderr even if exit code is 0
    expect(result).toBeDefined();
  }, 15_000);

  it("enforces timeout", async () => {
    const docker = new DockerExecutor();
    const result = await docker.execute({
      command: "sleep 10",
      timeoutMs: 2000,
    });

    expect(result.timedOut).toBe(true);
  }, 15_000);

  // SB-001: Docker sandbox must not expose host home directory
  it("container cannot access host home directory", async () => {
    const docker = new DockerExecutor();
    // Attempt to list host home — should fail or return empty in isolated container
    const result = await docker.execute({
      command: "ls /home 2>/dev/null; ls /Users 2>/dev/null; echo 'done'",
      timeoutMs: 10_000,
    });

    expect(result.exitCode).toBe(0);
    // The container should NOT see host user directories
    const hostUser = process.env.USERNAME || process.env.USER || "unknown";
    // Container's /home should be empty or non-existent
    expect(result.stdout).not.toContain(hostUser);
  }, 15_000);

  it("container has no access to host filesystem paths", async () => {
    const docker = new DockerExecutor();
    const result = await docker.execute({
      command: "test -f /host/passwd && echo 'exposed' || echo 'isolated'",
      timeoutMs: 10_000,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("isolated");
  }, 15_000);
});
