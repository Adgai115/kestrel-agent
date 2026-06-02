/**
 * @kestrel/sandbox - Sandbox executor with timeout, env control, and output capture.
 */

export { DockerExecutor, type DockerExecutorConfig } from "./docker.js";
export type { SandboxConfig, SandboxExecutor, SandboxResult } from "./executor.js";
export { NodeSandbox } from "./nodesandbox.js";

export const KESTREL_SANDBOX_VERSION = "0.0.1";
