---
description: Choose the voice that reads replies
argument-hint: "[voice id, for example en-GB-RyanNeural]"
---

Pass `$ARGUMENTS` straight through without interpreting it. With no argument
this reports the current voice instead of changing it.

Run this and show the output exactly as it comes back, with nothing added:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/varterm.mjs" voice $ARGUMENTS
```
