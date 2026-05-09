# Feature: Markdown Stripping

## Overview
Add option to strip markdown formatting before TTS for cleaner speech output.

## Setting

### Add to package.json contributes.configuration
```json
"vartermCursor.stripMarkdown": {
  "type": "boolean",
  "default": true,
  "description": "Strip markdown formatting (headers, bold, links, code blocks) before speaking for cleaner audio output."
}
```

## Implementation

### Add sanitizeMarkdown function in extension.ts
```typescript
function sanitizeMarkdown(text: string): string {
  const config = vscode.workspace.getConfiguration('vartermCursor');
  if (!config.get('stripMarkdown', true)) {
    return text;
  }

  let result = text;
  
  // Code blocks → "code block"
  result = result.replace(/```[\s\S]*?```/g, ' code block ');
  
  // Inline code → just the text
  result = result.replace(/`([^`]+)`/g, '$1');
  
  // Headers → remove # symbols
  result = result.replace(/^#{1,6}\s+/gm, '');
  
  // Bold/italic → just the text
  result = result.replace(/\*\*([^*]+)\*\*/g, '$1');
  result = result.replace(/\*([^*]+)\*/g, '$1');
  result = result.replace(/__([^_]+)__/g, '$1');
  result = result.replace(/_([^_]+)_/g, '$1');
  
  // Links → just the link text
  result = result.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  
  // Images → "image"
  result = result.replace(/!\[([^\]]*)\]\([^)]+\)/g, 'image: $1');
  
  // List markers → remove
  result = result.replace(/^\s*[-*+]\s+/gm, '');
  result = result.replace(/^\s*\d+\.\s+/gm, '');
  
  // Blockquotes → remove >
  result = result.replace(/^\s*>\s+/gm, '');
  
  // Horizontal rules → pause
  result = result.replace(/^---+$/gm, '. ');
  result = result.replace(/^\*\*\*+$/gm, '. ');
  
  // HTML tags → remove
  result = result.replace(/<[^>]+>/g, '');
  
  // Multiple newlines → single space
  result = result.replace(/\n{3,}/g, '\n\n');
  
  // Multiple spaces → single space
  result = result.replace(/  +/g, ' ');
  
  return result.trim();
}
```

### Integrate with readTextAloud
```typescript
async function readTextAloud(
  context: vscode.ExtensionContext,
  text: string,
  source: string
): Promise<void> {
  // Apply markdown stripping
  const cleanText = sanitizeMarkdown(text);
  
  // ... rest of existing implementation using cleanText
}
```

## Testing
1. Enable `stripMarkdown` (default)
2. Select markdown text: `# Hello **world**`
3. Read aloud → Should say "Hello world" without "hash" or "asterisk"
4. Disable `stripMarkdown` in settings
5. Read same text → Should include raw symbols or speak differently

## Edge Cases
- Empty result after stripping → Show warning
- Very long code blocks → Might want to skip entirely
- Tables → Could convert to prose or skip

## Optional Enhancement: Per-Read Toggle
Add a command that reads without stripping, regardless of setting:

```json
{
  "command": "vartermCursor.readEditorRaw",
  "title": "Varterm: Read Editor Raw (No Formatting)"
}
```
