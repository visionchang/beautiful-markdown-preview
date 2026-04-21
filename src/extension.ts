import * as vscode from "vscode";
import MarkdownIt from "markdown-it";
import hljs from "highlight.js";
import {
  buildPreviewThemeCss,
  buildPreviewThemeOptionsHtml,
  DEFAULT_PREVIEW_THEME_ID,
  PREVIEW_THEME_CLASS_NAMES,
  PREVIEW_THEME_IDS,
  PREVIEW_THEME_MERMAID_MODE
} from "./theme-config";

const OPEN_PREVIEW_COMMAND = "beautifulMarkdownPreview.openPreview";

const markdown: MarkdownIt = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  highlight(code: string, lang: string): string {
    if (lang === "mermaid") {
      return `<div class="mermaid">${escapeHtml(code)}</div>`;
    }

    if (lang && hljs.getLanguage(lang)) {
      try {
        return `<pre class="code-block"><code class="hljs language-${escapeHtml(lang)}">${hljs.highlight(code, { language: lang }).value}</code></pre>`;
      } catch {
        // fallback below
      }
    }

    const escaped = escapeHtml(code);
    return `<pre class="code-block"><code class="hljs">${escaped}</code></pre>`;
  }
});
enhanceMarkdownWithSourceLineAnchors(markdown);

let previewPanel: vscode.WebviewPanel | undefined;
let currentDocUri: vscode.Uri | undefined;
let extensionBaseUri: vscode.Uri | undefined;
let ignoreEditorScrollSyncUntil = 0;
let lastPreviewToEditorSyncAt = 0;

export function activate(context: vscode.ExtensionContext): void {
  extensionBaseUri = context.extensionUri;

  const openPreviewCmd = vscode.commands.registerCommand(
    OPEN_PREVIEW_COMMAND,
    () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== "markdown") {
        vscode.window.showWarningMessage("Please open a Markdown file first.");
        return;
      }

      currentDocUri = editor.document.uri;

      if (previewPanel) {
        previewPanel.reveal(vscode.ViewColumn.Beside);
        updatePreview(previewPanel, editor.document);
        syncPreviewScrollFromEditor(editor, 80);
        return;
      }

      previewPanel = vscode.window.createWebviewPanel(
        "beautifulMarkdownPreview",
        `Preview: ${editor.document.fileName.split("/").pop()}`,
        vscode.ViewColumn.Beside,
        {
          enableScripts: true,
          localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "node_modules")]
        }
      );

      previewPanel.webview.onDidReceiveMessage(
        (message) => {
          if (!message || message.type !== "previewScrolled" || !currentDocUri) {
            return;
          }

          const editor = getCurrentMarkdownEditor();
          if (!editor) {
            return;
          }

          const targetLine = resolveTargetLineFromPreviewMessage(editor.document, message);
          const currentTopLine = editor.visibleRanges[0]?.start.line ?? 0;
          if (Math.abs(targetLine - currentTopLine) < 1) {
            return;
          }

          const now = Date.now();
          if (now - lastPreviewToEditorSyncAt < 16) {
            return;
          }

          lastPreviewToEditorSyncAt = now;
          ignoreEditorScrollSyncUntil = now + 90;
          const targetRange = new vscode.Range(targetLine, 0, targetLine, 0);
          editor.revealRange(targetRange, vscode.TextEditorRevealType.AtTop);
        },
        undefined,
        context.subscriptions
      );

      updatePreview(previewPanel, editor.document);
      syncPreviewScrollFromEditor(editor, 120);

      previewPanel.onDidDispose(
        () => {
          previewPanel = undefined;
          currentDocUri = undefined;
        },
        null,
        context.subscriptions
      );
    }
  );

  const docChange = vscode.workspace.onDidChangeTextDocument((event) => {
    if (!previewPanel || !currentDocUri) {
      return;
    }
    if (event.document.uri.toString() !== currentDocUri.toString()) {
      return;
    }
    updatePreview(previewPanel, event.document);
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor && activeEditor.document.uri.toString() === event.document.uri.toString()) {
      syncPreviewScrollFromEditor(activeEditor, 80);
    }
  });

  const activeEditorChange = vscode.window.onDidChangeActiveTextEditor((editor) => {
    if (!previewPanel || !editor || editor.document.languageId !== "markdown") {
      return;
    }
    currentDocUri = editor.document.uri;
    updatePreview(previewPanel, editor.document);
    syncPreviewScrollFromEditor(editor, 80);
  });

  const visibleRangeChange = vscode.window.onDidChangeTextEditorVisibleRanges((event) => {
    if (!previewPanel || !currentDocUri) {
      return;
    }
    if (event.textEditor.document.uri.toString() !== currentDocUri.toString()) {
      return;
    }
    syncPreviewScrollFromEditor(event.textEditor);
  });

  const codeLensProvider = vscode.languages.registerCodeLensProvider(
    { language: "markdown" },
    new MarkdownPreviewCodeLensProvider()
  );

  context.subscriptions.push(
    openPreviewCmd,
    docChange,
    activeEditorChange,
    visibleRangeChange,
    codeLensProvider
  );
}

export function deactivate(): void {}

class MarkdownPreviewCodeLensProvider implements vscode.CodeLensProvider {
  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (document.languageId !== "markdown") {
      return [];
    }

    const firstLine = new vscode.Range(0, 0, 0, 0);
    const openPreviewLens = new vscode.CodeLens(firstLine, {
      title: "$(eye) Open Beautiful Preview",
      command: OPEN_PREVIEW_COMMAND
    });

    return [openPreviewLens];
  }
}

function updatePreview(panel: vscode.WebviewPanel, document: vscode.TextDocument): void {
  if (!extensionBaseUri) {
    return;
  }
  const rendered = markdown.render(document.getText());
  const fileName = document.fileName.split("/").pop() ?? "Markdown";
  panel.title = `Preview: ${fileName}`;
  panel.webview.html = getWebviewContent(panel.webview, rendered, fileName, extensionBaseUri);
}

function syncPreviewScrollFromEditor(
  editor: vscode.TextEditor,
  delayMs = 0
): void {
  if (Date.now() < ignoreEditorScrollSyncUntil) {
    return;
  }

  if (!previewPanel || !currentDocUri) {
    return;
  }
  if (editor.document.uri.toString() !== currentDocUri.toString()) {
    return;
  }

  const firstVisibleRange = editor.visibleRanges[0];
  if (!firstVisibleRange) {
    return;
  }

  const totalLines = Math.max(editor.document.lineCount - 1, 1);
  const ratio = Math.max(0, Math.min(1, firstVisibleRange.start.line / totalLines));
  const line = firstVisibleRange.start.line;

  const postScrollMessage = () => {
    previewPanel?.webview.postMessage({
      type: "syncScroll",
      ratio,
      line
    });
  };

  if (delayMs > 0) {
    setTimeout(postScrollMessage, delayMs);
    return;
  }

  postScrollMessage();
}

function getCurrentMarkdownEditor(): vscode.TextEditor | undefined {
  if (!currentDocUri) {
    return undefined;
  }

  const active = vscode.window.activeTextEditor;
  if (active && active.document.uri.toString() === currentDocUri.toString()) {
    return active;
  }

  return vscode.window.visibleTextEditors.find(
    (editor) => editor.document.uri.toString() === currentDocUri?.toString()
  );
}

function resolveTargetLineFromPreviewMessage(
  document: vscode.TextDocument,
  message: { line?: unknown; ratio?: unknown }
): number {
  const maxLine = Math.max(document.lineCount - 1, 0);
  if (typeof message.line === "number" && Number.isFinite(message.line)) {
    return clampLine(Math.round(message.line), maxLine);
  }

  if (typeof message.ratio === "number" && Number.isFinite(message.ratio)) {
    const ratio = Math.max(0, Math.min(1, message.ratio));
    return clampLine(Math.round(ratio * maxLine), maxLine);
  }

  return 0;
}

function clampLine(line: number, maxLine: number): number {
  return Math.max(0, Math.min(maxLine, line));
}

function getWebviewContent(
  webview: vscode.Webview,
  bodyHtml: string,
  title: string,
  extensionUri: vscode.Uri
): string {
  const nonce = getNonce();
  const previewThemeCss = buildPreviewThemeCss();
  const previewThemeOptions = buildPreviewThemeOptionsHtml();
  const previewThemeIdsJson = JSON.stringify(PREVIEW_THEME_IDS);
  const previewThemeClassNamesJson = JSON.stringify(PREVIEW_THEME_CLASS_NAMES);
  const previewMermaidModeByThemeJson = JSON.stringify(PREVIEW_THEME_MERMAID_MODE);
  const mermaidScriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "node_modules", "mermaid", "dist", "mermaid.min.js")
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta
    http-equiv="Content-Security-Policy"
    content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'nonce-${nonce}';"
  />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      color-scheme: light dark;
      --font-main: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --font-code: "JetBrains Mono", "Fira Code", Menlo, Consolas, monospace;
    }
    * {
      box-sizing: border-box;
    }
    body {
      margin: 0;
      font-family: var(--font-main);
      line-height: 1.7;
      transition: background-color 180ms ease, color 180ms ease;
    }
    .topbar {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      display: flex;
      align-items: center;
      justify-content: space-between;
      min-height: 42px;
      padding: 6px 12px;
      backdrop-filter: blur(8px);
      border-bottom: 1px solid var(--border);
      background: var(--topbar-bg);
      z-index: 30;
      transform: translateY(calc(-100% + 10px));
      transition: transform 200ms ease;
      pointer-events: auto;
      overflow: visible;
    }
    body.topbar-visible .topbar {
      transform: translateY(0);
    }
    .topbar-handle {
      position: absolute;
      bottom: 3px;
      left: 50%;
      width: 34px;
      height: 4px;
      border-radius: 999px;
      transform: translateX(-50%);
      background: color-mix(in srgb, var(--text-main) 20%, transparent);
      opacity: 0.45;
      pointer-events: none;
      transition: opacity 160ms ease, transform 160ms ease;
    }
    body.topbar-visible .topbar-handle {
      opacity: 0.08;
      transform: translateX(-50%) translateY(-6px);
    }
    .topbar-reveal-zone {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: 18px;
      z-index: 31;
    }
    .title {
      font-weight: 700;
      font-size: 0.88rem;
      letter-spacing: 0.1px;
    }
    .theme-select {
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text-main);
      padding: 4px 8px;
      border-radius: 8px;
      font-size: 0.8rem;
      outline: none;
    }
    .container {
      max-width: 900px;
      margin: 0 auto;
      padding: 8px 24px 80px;
    }
    h1, h2, h3, h4, h5, h6 {
      line-height: 1.3;
      margin-top: 1.4em;
      margin-bottom: 0.6em;
      color: var(--heading);
    }
    p, li {
      color: var(--text-main);
    }
    a {
      color: var(--link);
      text-decoration: none;
    }
    a:hover {
      text-decoration: underline;
    }
    blockquote {
      margin: 1.2em 0;
      padding: 0.7em 1em;
      border-left: 4px solid var(--quote-border);
      background: var(--quote-bg);
      border-radius: 10px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 1.2em 0;
      overflow: hidden;
      border-radius: 10px;
      border: 1px solid var(--border);
    }
    th, td {
      border-bottom: 1px solid var(--border);
      border-right: 1px solid var(--border);
      padding: 10px 12px;
      text-align: left;
    }
    th:last-child, td:last-child {
      border-right: none;
    }
    th {
      background: var(--table-head-bg);
    }
    img {
      max-width: 100%;
      border-radius: 10px;
    }
    code {
      font-family: var(--font-code);
      background: var(--inline-code-bg);
      color: var(--inline-code-text);
      padding: 0.16em 0.38em;
      border-radius: 6px;
      font-size: 0.92em;
    }
    .code-block {
      margin: 1.2em 0;
      padding: 14px 16px;
      border-radius: 14px;
      overflow-x: auto;
      background: var(--code-bg);
      border: 1px solid var(--code-border);
      color: var(--code-text);
    }
    .code-block code {
      background: transparent;
      color: var(--code-text);
      padding: 0;
    }
    .code-block .hljs {
      color: var(--code-text);
    }
    .code-block .hljs-keyword,
    .code-block .hljs-selector-tag,
    .code-block .hljs-literal,
    .code-block .hljs-section,
    .code-block .hljs-link {
      color: var(--syntax-keyword);
    }
    .code-block .hljs-string,
    .code-block .hljs-title,
    .code-block .hljs-name,
    .code-block .hljs-type,
    .code-block .hljs-attribute,
    .code-block .hljs-symbol,
    .code-block .hljs-bullet,
    .code-block .hljs-addition {
      color: var(--syntax-string);
    }
    .code-block .hljs-number,
    .code-block .hljs-quote,
    .code-block .hljs-template-tag,
    .code-block .hljs-template-variable {
      color: var(--syntax-number);
    }
    .code-block .hljs-comment,
    .code-block .hljs-meta,
    .code-block .hljs-deletion {
      color: var(--syntax-comment);
    }
    strong {
      color: var(--heading);
    }
    em {
      color: var(--emphasis);
    }
    .mermaid {
      margin: 1.2em 0;
      padding: 10px;
      border-radius: 12px;
      border: 1px solid var(--border);
      background: var(--surface);
      overflow-x: auto;
    }
    .mermaid svg {
      display: block;
      margin: 0 auto;
      max-width: 100%;
      height: auto;
    }
    hr {
      border: 0;
      border-top: 1px solid var(--border);
      margin: 2em 0;
    }
    ${previewThemeCss}
  </style>
</head>
<body class="theme-${DEFAULT_PREVIEW_THEME_ID}">
  <div class="topbar-reveal-zone"></div>
  <div class="topbar">
    <div class="topbar-handle"></div>
    <div class="title">${escapeHtml(title)}</div>
    <select id="themeSelect" class="theme-select">
      ${previewThemeOptions}
    </select>
  </div>
  <main class="container">
    ${bodyHtml}
  </main>

  <script src="${mermaidScriptUri}"></script>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const themeSelect = document.getElementById("themeSelect");
    const topbar = document.querySelector(".topbar");
    const topbarRevealZone = document.querySelector(".topbar-reveal-zone");
    const body = document.body;
    let ignorePreviewScrollSyncUntil = 0;
    let scrollSyncRafId = 0;
    let lastPostedScrollAt = 0;
    let lastPostedScrollLine = -1;
    const previewSyncTopOffsetPx = 30;
    let topbarHideTimer = null;
    const defaultTheme = "${DEFAULT_PREVIEW_THEME_ID}";
    const validThemes = ${previewThemeIdsJson};
    const themeClassNames = ${previewThemeClassNamesJson};
    const mermaidModeByTheme = ${previewMermaidModeByThemeJson};
    const savedThemeRaw = localStorage.getItem("bmp-theme");
    const savedTheme = validThemes.includes(savedThemeRaw) ? savedThemeRaw : defaultTheme;

    applyTheme(savedTheme);
    themeSelect.value = savedTheme;
    renderMermaid(savedTheme);
    showTopbarTemporarily(2000);

    themeSelect.addEventListener("change", async () => {
      applyTheme(themeSelect.value);
      localStorage.setItem("bmp-theme", themeSelect.value);
      await renderMermaid(themeSelect.value);
    });

    function applyTheme(themeName) {
      body.classList.remove(...themeClassNames);
      body.classList.add("theme-" + themeName);
    }

    function setTopbarVisible(visible) {
      body.classList.toggle("topbar-visible", visible);
    }

    function clearTopbarHideTimer() {
      if (topbarHideTimer) {
        clearTimeout(topbarHideTimer);
        topbarHideTimer = null;
      }
    }

    function scheduleTopbarHide(delayMs = 160) {
      clearTopbarHideTimer();
      topbarHideTimer = setTimeout(() => {
        setTopbarVisible(false);
      }, delayMs);
    }

    function showTopbarTemporarily(durationMs) {
      clearTopbarHideTimer();
      setTopbarVisible(true);
      topbarHideTimer = setTimeout(() => {
        setTopbarVisible(false);
      }, durationMs);
    }

    function toMermaidTheme(themeName) {
      const mermaidMode = mermaidModeByTheme[themeName] || "default";
      if (mermaidMode === "auto") {
        return body.classList.contains("vscode-dark") || body.classList.contains("vscode-high-contrast")
          ? "dark"
          : "default";
      }
      return mermaidMode;
    }

    async function renderMermaid(themeName) {
      if (!window.mermaid) {
        return;
      }

      const nodes = Array.from(document.querySelectorAll(".mermaid"));
      if (!nodes.length) {
        return;
      }

      for (const node of nodes) {
        if (!node.dataset.source) {
          node.dataset.source = node.textContent || "";
        }
        node.removeAttribute("data-processed");
        node.textContent = node.dataset.source;
      }

      try {
        window.mermaid.initialize({
          startOnLoad: false,
          securityLevel: "loose",
          theme: toMermaidTheme(themeName)
        });
        await window.mermaid.run({ nodes });
      } catch (error) {
        console.error("Mermaid render failed:", error);
      }
    }

    const editorThemeObserver = new MutationObserver(() => {
      if (themeSelect.value === defaultTheme) {
        renderMermaid(defaultTheme);
      }
    });
    editorThemeObserver.observe(document.body, { attributes: true, attributeFilter: ["class"] });

    topbarRevealZone.addEventListener("mouseenter", () => {
      clearTopbarHideTimer();
      setTopbarVisible(true);
    });

    topbarRevealZone.addEventListener("mousemove", () => {
      clearTopbarHideTimer();
      setTopbarVisible(true);
    });

    topbar.addEventListener("mouseenter", () => {
      clearTopbarHideTimer();
      setTopbarVisible(true);
    });

    topbar.addEventListener("mouseleave", () => {
      scheduleTopbarHide(120);
    });

    document.addEventListener("mousemove", (event) => {
      if (event.clientY <= 20) {
        clearTopbarHideTimer();
        setTopbarVisible(true);
      } else if (!topbar.matches(":hover")) {
        scheduleTopbarHide(160);
      }
    });

    window.addEventListener("message", (event) => {
      const message = event.data;
      if (!message || message.type !== "syncScroll") {
        return;
      }

      const aligned = scrollToSourceLine(message.line);
      if (!aligned) {
        const maxScroll = Math.max(
          document.documentElement.scrollHeight - window.innerHeight,
          0
        );
        const target = Math.round(maxScroll * message.ratio) - previewSyncTopOffsetPx;
        window.scrollTo({ top: target, behavior: "auto" });
      }
      ignorePreviewScrollSyncUntil = Date.now() + 90;
    });

    function scrollToSourceLine(line) {
      if (typeof line !== "number" || Number.isNaN(line)) {
        return false;
      }

      const markerNodes = Array.from(document.querySelectorAll("[data-source-line]"));
      if (!markerNodes.length) {
        return false;
      }

      const markers = markerNodes
        .map((node) => ({
          node,
          line: Number(node.getAttribute("data-source-line"))
        }))
        .filter((item) => Number.isFinite(item.line))
        .sort((a, b) => a.line - b.line);

      if (!markers.length) {
        return false;
      }

      let left = 0;
      let right = markers.length - 1;
      let bestIndex = 0;

      while (left <= right) {
        const mid = Math.floor((left + right) / 2);
        if (markers[mid].line <= line) {
          bestIndex = mid;
          left = mid + 1;
        } else {
          right = mid - 1;
        }
      }

      const current = markers[bestIndex];
      const next = markers[bestIndex + 1];

      const currentTop = current.node.getBoundingClientRect().top + window.scrollY;
      let targetTop = currentTop;

      if (next && next.line > current.line) {
        const nextTop = next.node.getBoundingClientRect().top + window.scrollY;
        const progress = Math.max(0, Math.min(1, (line - current.line) / (next.line - current.line)));
        targetTop = currentTop + (nextTop - currentTop) * progress;
      }

      const maxScroll = Math.max(
        document.documentElement.scrollHeight - window.innerHeight,
        0
      );
      const clampedTop = Math.max(0, Math.min(maxScroll, targetTop - previewSyncTopOffsetPx));
      window.scrollTo({ top: clampedTop, behavior: "auto" });
      return true;
    }

    window.addEventListener("scroll", () => {
      if (Date.now() < ignorePreviewScrollSyncUntil) {
        return;
      }

      if (scrollSyncRafId) {
        return;
      }

      scrollSyncRafId = requestAnimationFrame(() => {
        scrollSyncRafId = 0;
        const payload = getPreviewScrollPayload();
        const now = Date.now();
        if (payload.line === lastPostedScrollLine && now - lastPostedScrollAt < 24) {
          return;
        }

        lastPostedScrollAt = now;
        lastPostedScrollLine = payload.line;
        vscode.postMessage({
          type: "previewScrolled",
          ...payload
        });
      });
    }, { passive: true });

    function getPreviewScrollPayload() {
      const line = getSourceLineAtViewportTop();
      const maxScroll = Math.max(
        document.documentElement.scrollHeight - window.innerHeight,
        1
      );
      const ratio = Math.max(0, Math.min(1, window.scrollY / maxScroll));
      return {
        line,
        ratio
      };
    }

    function getSourceLineAtViewportTop() {
      const markerNodes = Array.from(document.querySelectorAll("[data-source-line]"));
      if (!markerNodes.length) {
        return 0;
      }

      const markers = markerNodes
        .map((node) => ({
          line: Number(node.getAttribute("data-source-line")),
          top: node.getBoundingClientRect().top + window.scrollY
        }))
        .filter((item) => Number.isFinite(item.line) && Number.isFinite(item.top))
        .sort((a, b) => a.top - b.top);

      if (!markers.length) {
        return 0;
      }

      const y = window.scrollY;
      let index = 0;
      for (let i = 0; i < markers.length; i += 1) {
        if (markers[i].top <= y) {
          index = i;
        } else {
          break;
        }
      }

      const current = markers[index];
      const next = markers[index + 1];
      if (!next || next.top <= current.top || next.line <= current.line) {
        return Math.round(current.line);
      }

      const progress = Math.max(0, Math.min(1, (y - current.top) / (next.top - current.top)));
      return Math.round(current.line + (next.line - current.line) * progress);
    }
  </script>
</body>
</html>`;
}

function enhanceMarkdownWithSourceLineAnchors(md: MarkdownIt): void {
  const blockOpenRules = [
    "paragraph_open",
    "heading_open",
    "blockquote_open",
    "bullet_list_open",
    "ordered_list_open",
    "list_item_open",
    "table_open",
    "thead_open",
    "tbody_open",
    "tr_open"
  ];

  for (const ruleName of blockOpenRules) {
    const defaultRule = md.renderer.rules[ruleName];
    md.renderer.rules[ruleName] = (tokens: any[], idx: number, options: any, env: any, self: any): string => {
      const token = tokens[idx];
      const startLine = token?.map?.[0];
      if (Number.isInteger(startLine) && typeof token.attrSet === "function") {
        token.attrSet("data-source-line", String(startLine));
      }

      if (defaultRule) {
        return defaultRule(tokens, idx, options, env, self);
      }
      return self.renderToken(tokens, idx, options);
    };
  }

  const fenceDefaultRule = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens: any[], idx: number, options: any, env: any, self: any): string => {
    const token = tokens[idx];
    const startLine = token?.map?.[0];
    const anchor = Number.isInteger(startLine)
      ? `<div data-source-line="${String(startLine)}"></div>`
      : "";

    if (fenceDefaultRule) {
      return `${anchor}${fenceDefaultRule(tokens, idx, options, env, self)}`;
    }
    return `${anchor}${self.renderToken(tokens, idx, options)}`;
  };
}

function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";
  for (let i = 0; i < 32; i += 1) {
    value += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return value;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
