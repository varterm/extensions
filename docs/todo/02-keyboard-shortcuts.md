# Feature: Keyboard Shortcuts

## Overview
Add default keyboard shortcuts for common TTS commands for faster access.

## Keybindings to Add

| Command | Windows/Linux | Mac | When |
|---------|---------------|-----|------|
| Read Editor/Selection | `Ctrl+Shift+R` | `Cmd+Shift+R` | Editor focused |
| Read Clipboard | `Ctrl+Shift+C` | `Cmd+Shift+C` | Always |
| Read Errors | `Ctrl+Shift+E` | `Cmd+Shift+E` | Always |
| Stop Speaking | `Ctrl+Shift+S` | `Cmd+Shift+S` | Always |

## Implementation

### Add to package.json contributes.keybindings
```json
"keybindings": [
  {
    "command": "vartermCursor.readEditorAloud",
    "key": "ctrl+shift+r",
    "mac": "cmd+shift+r",
    "when": "editorTextFocus"
  },
  {
    "command": "vartermCursor.readClipboardAloud",
    "key": "ctrl+shift+c",
    "mac": "cmd+shift+c"
  },
  {
    "command": "vartermCursor.readErrorsAloud",
    "key": "ctrl+shift+e",
    "mac": "cmd+shift+e"
  },
  {
    "command": "vartermCursor.stopSpeaking",
    "key": "ctrl+shift+s",
    "mac": "cmd+shift+s"
  }
]
```

## New Command: Stop Speaking
Need to add a stop command if not already present:

### package.json
```json
{
  "command": "vartermCursor.stopSpeaking",
  "title": "Varterm: Stop Speaking"
}
```

### extension.ts
```typescript
// Track current audio for stopping
let currentAudioPlayer: { stop: () => void } | null = null;

function stopSpeaking(): void {
  if (currentAudioPlayer) {
    currentAudioPlayer.stop();
    currentAudioPlayer = null;
    vscode.window.showInformationMessage('Stopped speaking');
  }
}

// Register
register('vartermCursor.stopSpeaking', () => stopSpeaking());
```

## Conflict Consideration
- `Ctrl+Shift+E` may conflict with "Show Explorer" in some setups
- `Ctrl+Shift+R` may conflict with "Reload Window" in dev mode
- Users can customize via Keyboard Shortcuts settings

## Testing
1. Open any file
2. Select text and press `Cmd+Shift+R` - should read selection
3. Copy text and press `Cmd+Shift+C` - should read clipboard
4. Create an error and press `Cmd+Shift+E` - should read errors
5. While speaking, press `Cmd+Shift+S` - should stop
