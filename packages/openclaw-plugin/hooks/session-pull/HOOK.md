---
name: session-pull
description: Auto-pull workspace files from GitHub on session start
metadata:
  openclaw:
    emoji: "🔄"
    events: ["session_start"]
    requires:
      bins: [jq, gh]
---

# Session Pull Hook

Automatically pulls the latest workspace files from the configured GitHub sync repo when a new session starts. Runs silently — only reports if files were actually pulled.
