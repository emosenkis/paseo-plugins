import { spawn, type ChildProcess } from "node:child_process";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { createMonitor, inhibitorCommand } from "./server/keep-awake";

let inhibitor: ChildProcess | undefined;

function startInhibitor() {
  if (inhibitor) return;
  const platform = process.platform === "darwin" || process.platform === "win32" ? process.platform : "linux";
  const [command, args] = inhibitorCommand(platform);
  const child = spawn(command, args, { stdio: "ignore" });
  inhibitor = child;
  child.once("error", (error) => {
    console.error(`agent-keep-awake: failed to run ${command}`, error);
    if (inhibitor === child) inhibitor = undefined;
  });
  child.once("exit", () => {
    if (inhibitor === child) inhibitor = undefined;
  });
}

function stopInhibitor() {
  inhibitor?.kill();
  inhibitor = undefined;
}

export default function contribute(server: PluginServerContext) {
  const monitor = createMonitor(startInhibitor, stopInhibitor);
  // ponytail: lifecycle events are not replayed; use a startup snapshot if Paseo exposes one.
  const removeStarted = server.on("agent.turn_started", ({ agent }) => monitor.started(agent.id));
  const removeEnded = server.on("agent.turn_ended", ({ agent }) => monitor.ended(agent.id));
  return () => {
    removeStarted();
    removeEnded();
    monitor.cleanup();
  };
}
