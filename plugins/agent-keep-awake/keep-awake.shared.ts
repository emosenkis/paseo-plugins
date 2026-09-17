import { defineRpc } from "@getpaseo/plugin/server";
import { z } from "zod";

export const startKeepAwake = defineRpc({
  name: "keep-awake.start",
  input: z.object({}),
  output: z.object({ ok: z.boolean() }),
});
