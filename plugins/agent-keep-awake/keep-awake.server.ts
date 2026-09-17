import { spawn, type ChildProcess } from "node:child_process";
import type { PaseoApi } from "@getpaseo/client";
import type { PluginContext } from "@getpaseo/plugin";
import { startKeepAwake } from "./keep-awake.shared";
import { inhibitorCommand } from "./platform";

let inhibitor: ChildProcess | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let unsubscribe: (() => void) | undefined;

function startInhibitor() {
  if (inhibitor) return;
  const [command, args] = inhibitorCommand(process.platform === "darwin" || process.platform === "win32" ? process.platform : "linux");
  inhibitor = spawn(command, args, { stdio: "ignore" });
  inhibitor.once("exit", () => { inhibitor = undefined; });
}

function stopInhibitor() {
  inhibitor?.kill();
  inhibitor = undefined;
}

async function refresh(paseo: PaseoApi) {
  try {
    const { entries } = await paseo.agents.list({
      scope: "active",
      filter: { statuses: ["initializing", "running"] },
    });
    if (entries.length) startInhibitor();
    else stopInhibitor();
  } catch (error) {
    console.error("agent-keep-awake: failed to inspect agents", error);
  }
}

function startMonitor(paseo: PaseoApi) {
  if (timer) return;
  void refresh(paseo);
  timer = setInterval(() => void refresh(paseo), 5000);
  unsubscribe = paseo.agents.subscribe(() => void refresh(paseo));
}

export function registerServer(plugin: PluginContext) {
  plugin.handle(startKeepAwake, async (_input, { paseo }) => {
    startMonitor(paseo);
    return { ok: true };
  });
}

export function cleanupServer() {
  if (timer) clearInterval(timer);
  timer = undefined;
  unsubscribe?.();
  unsubscribe = undefined;
  stopInhibitor();
}
