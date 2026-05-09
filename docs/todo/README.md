# TODO: Feature Backlog

These features enhance the TTS functionality of the Varterm extension.

## Priority Order

| # | Feature | Effort | Impact |
|---|---------|--------|--------|
| 1 | [Read Errors & Warnings](./01-read-errors-warnings.md) | Medium | High |
| 2 | [Keyboard Shortcuts](./02-keyboard-shortcuts.md) | Low | High |
| 3 | [Context Menu](./03-context-menu.md) | Low | Medium |
| 4 | [Markdown Stripping](./04-markdown-stripping.md) | Medium | Medium |

## Implementation Notes

- All features build on existing `readTextAloud()` function
- Keyboard shortcuts may have conflicts - test thoroughly
- Consider bundling all 4 in a single release (v0.2.0)

## Files to Modify

- `package.json` - commands, keybindings, menus, settings
- `src/extension.ts` - new functions, register commands

## Testing Checklist

- [ ] All new commands appear in Command Palette
- [ ] Keyboard shortcuts work on Mac and Windows
- [ ] Context menu shows correct options based on selection
- [ ] Markdown stripping handles all common patterns
- [ ] Settings are respected and can be changed
