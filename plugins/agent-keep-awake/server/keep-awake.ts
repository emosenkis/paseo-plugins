export function inhibitorCommand(platform: "darwin" | "linux" | "win32") {
  if (platform === "darwin") return ["caffeinate", ["-is"]] as const;
  if (platform === "win32") {
    const script = "$sig=@'\nusing System;\nusing System.Runtime.InteropServices;\npublic static class P { [DllImport(\"kernel32.dll\")] public static extern uint SetThreadExecutionState(uint f); }\n'@; Add-Type $sig; [P]::SetThreadExecutionState(0x80000001); while ($true) { Start-Sleep 30 }";
    return ["powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]] as const;
  }
  return ["systemd-inhibit", ["--what=sleep", "--why=Paseo keep awake", "--mode=block", "sleep", "infinity"]] as const;
}

export function createMonitor(start: () => void, stop: () => void) {
  const active = new Set<string>();
  let manual = false;
  return {
    get manual() { return manual; },
    setManual(enabled: boolean) {
      if (manual === enabled) return;
      manual = enabled;
      if (enabled) start();
      else if (active.size === 0) stop();
    },
    started(agentId: string) {
      const wasIdle = active.size === 0;
      active.add(agentId);
      if (wasIdle && !manual) start();
    },
    ended(agentId: string) {
      if (active.delete(agentId) && active.size === 0 && !manual) stop();
    },
    cleanup() {
      manual = false;
      active.clear();
      stop();
    },
  };
}
