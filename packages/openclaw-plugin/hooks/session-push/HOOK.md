---
name: session-push
description: Auto-push workspace changes to GitHub on session end
metadata:
  openclaw:
    emoji: "📤"
    events: ["session_end"]
    requires:
      bins: [jq, gh]
---

# Session Push Hook

Automatically pushes local workspace changes to the configured GitHub sync repo when a session ends. Only pushes if there are pending changes. Runs silently.
