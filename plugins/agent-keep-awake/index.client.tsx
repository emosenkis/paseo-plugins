import type { PluginClientContext } from "@getpaseo/plugin/client";
import { KeepAwake } from "./client/keep-awake";

export default function contribute(client: PluginClientContext) {
  return client.addSidebarFooterItem({ id: "keep-awake", title: "Keep awake", Component: KeepAwake });
}
