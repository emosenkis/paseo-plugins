import type { PluginContext } from "@getpaseo/plugin";
import { startKeepAwake } from "./keep-awake.shared";
import { cleanupServer, registerServer } from "./keep-awake.server";

export default function contribute(plugin: PluginContext) {
  registerServer(plugin);
  plugin.addClientSide(({ rpc }) => {
    void rpc(startKeepAwake, {}).catch((error) => {
      console.error("agent-keep-awake: failed to start", error);
    });
    return () => {};
  });
  return cleanupServer;
}
