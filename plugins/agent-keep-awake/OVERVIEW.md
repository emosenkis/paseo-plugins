Keeps the daemon's computer awake while agent turns run. Enable **Keep awake** in the sidebar footer to prevent sleep even when no agent is running. Turn it off to return to automatic behavior.

Screen locking and display power-off remain available. Manual mode applies to the selected host and resets when the plugin or daemon restarts. Disabling the plugin releases its sleep inhibitor.

Requires Paseo 0.11.2 or later. Uses macOS `caffeinate`, Linux `systemd-inhibit`, or Windows PowerShell. OS power policies, lid closure, and explicit sleep actions may override inhibition.
