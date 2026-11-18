import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const keepAwake = defineRpc({
  name: "keep-awake",
  input: z.object({ enabled: z.boolean().optional() }),
  output: z.object({ enabled: z.boolean() }),
});
