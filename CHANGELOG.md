# Changelog

## 0.0.8

- Update preview content without reloading the Webview or Mermaid script while typing
- Added bidirectional scroll sync to Open With → Beautiful Preview, with independent state per preview
- Fixed HTML anchors without a source-line attribute incorrectly syncing the editor to line zero

## 0.0.7

- Added preview font size controls with remembered custom sizes shared across preview panels
- Preview font size follows the Markdown editor settings by default; Reset restores this behavior

## 0.0.6

- Added local image preview in the webview (relative, workspace-root, `file://`, and HTML `<img>` paths)

## 0.0.5

- Added explorer context menu to open Beautiful Preview from a Markdown file
- Added Open With → Beautiful Preview via custom editor
- Updated extension icon

## 0.0.4

- Fixed in-document anchor navigation
- Added back-to-top button
- Sync editor position on anchor jump and back-to-top

## 0.0.3

- Cached preview theme CSS, theme selector HTML, and related JSON at activation to avoid rebuilding on each preview refresh
- Inlined `mermaid.min.js` content into the webview when readable from disk (falls back to a script URL) for more reliable CSP / nonce behaviour
- Show the preview top-bar hint only once (tracked in `localStorage` as `bmp-topbar-hint`)

## 0.0.2

- Fixed code block text color visibility issues
- Reduced VSIX package size by excluding sourcemaps, demo, docs and test files

## 0.0.1

- Initial release
- Added built-in theme switching support
- Added Scroll Sync between editor and preview
