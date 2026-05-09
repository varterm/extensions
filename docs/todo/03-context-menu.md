# Feature: Editor Context Menu

## Overview
Add right-click context menu options in the editor for quick TTS access.

## Menu Items

When text is selected:
- "Varterm: Read Selection Aloud"

When no selection:
- "Varterm: Read Line Aloud"

## Implementation

### Add to package.json contributes.menus
```json
"menus": {
  "editor/context": [
    {
      "command": "vartermCursor.readEditorAloud",
      "when": "editorHasSelection",
      "group": "varterm@1"
    },
    {
      "command": "vartermCursor.readLineAloud",
      "when": "editorTextFocus && !editorHasSelection",
      "group": "varterm@1"
    }
  ]
}
```

### New Command: Read Current Line
```json
{
  "command": "vartermCursor.readLineAloud",
  "title": "Varterm: Read Line Aloud"
}
```

### extension.ts
```typescript
async function readLineAloud(context: vscode.ExtensionContext): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('No active editor');
    return;
  }
  
  const line = editor.document.lineAt(editor.selection.active.line);
  const text = line.text.trim();
  
  if (!text) {
    vscode.window.showWarningMessage('Current line is empty');
    return;
  }
  
  await readTextAloud(context, text, 'current line');
}

// Register
register('vartermCursor.readLineAloud', () => readLineAloud(context));
```

## Menu Group
Using `group: "varterm@1"` places items together in a "varterm" section.
The `@1` suffix controls ordering within the group.

## Alternative: Submenu
For cleaner organization, could use a submenu:

```json
"submenus": [
  {
    "id": "varterm.submenu",
    "label": "Varterm TTS"
  }
],
"menus": {
  "editor/context": [
    {
      "submenu": "varterm.submenu",
      "group": "navigation"
    }
  ],
  "varterm.submenu": [
    {
      "command": "vartermCursor.readEditorAloud",
      "when": "editorHasSelection"
    },
    {
      "command": "vartermCursor.readLineAloud",
      "when": "!editorHasSelection"
    },
    {
      "command": "vartermCursor.readErrorsAloud"
    }
  ]
}
```

## Testing
1. Select text in editor → Right-click → "Varterm: Read Selection Aloud" appears
2. Deselect text → Right-click → "Varterm: Read Line Aloud" appears
3. Click either option → TTS plays
