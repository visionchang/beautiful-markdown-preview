# Beautiful Markdown Preview

A more polished Markdown preview extension with multiple switchable themes.

## Features

- Custom preview panel (opens side by side with the editor)
- Live refresh (auto-updates while editing Markdown)
- One-click button at the top of the Markdown editor (CodeLens)
- One-click button in the editor title bar (Markdown files only)
- 8 built-in themes (default follows the editor theme):
  - Studio Sync (Default, automatically follows the current editor theme)
  - Aurora (Light)
  - Paper (Warm)
  - Midnight (Dark)
  - Forest (Dark Green)
  - Sakura (Soft Pink)
  - Graphite (Dark Gray)
  - Ocean (Deep Blue)
- Code block highlighting (`highlight.js`)
- Mermaid diagram rendering (```mermaid)

## Usage

1. Open a `.md` file.
2. Click the button at the top of the Markdown editor: `Open Beautiful Preview`.
3. Or click the button in the editor title bar (top-right for Markdown files).
4. You can also run the command from Command Palette: `Beautiful Markdown Preview: Open Preview`.
5. Use the dropdown at the top of the preview panel to switch themes.

## Local Development

```bash
npm install
npm run compile
```

Theme configuration has been split into `src/theme-config.ts`, where you can maintain theme colors, names, and Mermaid theme mapping.

Then press `F5` to launch the Extension Development Host for debugging.
