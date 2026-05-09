# Feature: Read Errors & Warnings Aloud

## Overview
Add a command to read all current diagnostics (errors, warnings) aloud using TTS.

## Command
- **ID:** `vartermCursor.readErrorsAloud`
- **Title:** `Varterm: Read Errors & Warnings Aloud`

## Behavior
1. Get diagnostics for current file (or all open files)
2. Format them into speakable text
3. Use existing `readTextAloud()` function to speak

## Implementation

### Add to package.json contributes.commands
```json
{
  "command": "vartermCursor.readErrorsAloud",
  "title": "Varterm: Read Errors & Warnings Aloud"
}
```

### Add function in extension.ts
```typescript
async function readErrorsAloud(context: vscode.ExtensionContext): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  
  // Get diagnostics for current file or all files
  const diagnostics = editor 
    ? vscode.languages.getDiagnostics(editor.document.uri)
    : getAllDiagnostics();
  
  if (diagnostics.length === 0) {
    vscode.window.showInformationMessage('No errors or warnings found');
    return;
  }
  
  // Format for speech
  const errorText = diagnostics.map((d, i) => {
    const severity = d.severity === vscode.DiagnosticSeverity.Error ? 'Error' : 'Warning';
    const line = d.range.start.line + 1;
    return `${severity} on line ${line}: ${d.message}`;
  }).join('. ');
  
  const fullText = `Found ${diagnostics.length} issues. ${errorText}`;
  await readTextAloud(context, fullText, 'diagnostics');
}

function getAllDiagnostics(): vscode.Diagnostic[] {
  const allDiagnostics: vscode.Diagnostic[] = [];
  vscode.languages.getDiagnostics().forEach(([uri, diagnostics]) => {
    allDiagnostics.push(...diagnostics);
  });
  return allDiagnostics;
}
```

### Register command in activate()
```typescript
register('vartermCursor.readErrorsAloud', () => readErrorsAloud(context));
```

## Optional Enhancement: Auto-Read Errors
Add setting to automatically read new errors when they appear:

```json
"vartermCursor.autoReadErrors": {
  "type": "boolean",
  "default": false,
  "description": "Automatically read new errors aloud when they appear."
}
```

```typescript
// In activate()
if (config.get('autoReadErrors')) {
  context.subscriptions.push(
    vscode.languages.onDidChangeDiagnostics(() => {
      // Debounce and read only new errors
    })
  );
}
```

## Testing
1. Open a file with syntax errors
2. Run "Varterm: Read Errors & Warnings Aloud"
3. Verify all errors are read with line numbers
4. Verify empty state shows "No errors or warnings found"
