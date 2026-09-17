import assert from "node:assert/strict";
import test from "node:test";
import { createMonitor, inhibitorCommand } from "./keep-awake.ts";

test("stays awake until every running agent finishes", () => {
  const events: string[] = [];
  const monitor = createMonitor(() => events.push("awake"), () => events.push("idle"));
  monitor.started("a");
  monitor.started("b");
  monitor.ended("a");
  assert.deepEqual(events, ["awake"]);
  monitor.ended("b");
  assert.deepEqual(events, ["awake", "idle"]);
});

test("cleanup always releases the inhibitor", () => {
  const events: string[] = [];
  const monitor = createMonitor(() => events.push("awake"), () => events.push("idle"));
  monitor.started("a");
  monitor.cleanup();
  assert.deepEqual(events, ["awake", "idle"]);
});

test("selects the native inhibitor for each OS", () => {
  assert.deepEqual(inhibitorCommand("darwin"), ["caffeinate", ["-dimsu"]]);
  assert.equal(inhibitorCommand("linux")[0], "systemd-inhibit");
  const [command, args] = inhibitorCommand("win32");
  assert.equal(command, "powershell.exe");
  assert.match(args[3], /SetThreadExecutionState/);
});
