import assert from "node:assert/strict";
import test from "node:test";
import { inhibitorCommand } from "../platform.ts";

test("uses caffeinate on macOS", () => {
  assert.deepEqual(inhibitorCommand("darwin"), ["caffeinate", ["-dimsu"]]);
});

test("uses systemd-inhibit on Linux", () => {
  assert.deepEqual(inhibitorCommand("linux"), [
    "systemd-inhibit",
    ["--what=idle:sleep", "--why=Paseo agent is running", "--mode=block", "sleep", "infinity"],
  ]);
});

test("uses PowerShell on Windows", () => {
  const [command, args] = inhibitorCommand("win32");
  assert.equal(command, "powershell.exe");
  assert.deepEqual(args.slice(0, 3), ["-NoProfile", "-NonInteractive", "-Command"]);
  assert.match(args[3], /SetThreadExecutionState/);
});
