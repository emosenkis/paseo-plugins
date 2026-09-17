export function inhibitorCommand(platform: "darwin" | "linux" | "win32") {
  if (platform === "darwin") return ["caffeinate", ["-dimsu"]] as const;
  if (platform === "win32") {
    const script = "$sig=@'\nusing System;\nusing System.Runtime.InteropServices;\npublic static class P { [DllImport(\"kernel32.dll\")] public static extern uint SetThreadExecutionState(uint f); }\n'@; Add-Type $sig; [P]::SetThreadExecutionState(0x80000003); while ($true) { Start-Sleep 30 }";
    return ["powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]] as const;
  }
  return ["systemd-inhibit", ["--what=idle:sleep", "--why=Paseo agent is running", "--mode=block", "sleep", "infinity"]] as const;
}
