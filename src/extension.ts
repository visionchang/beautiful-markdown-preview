import * as fs from "fs";
import * as path from "path";
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
const CUSTOM_EDITOR_VIEW_TYPE = "beautifulMarkdownPreview.editor";

const markdown: MarkdownIt = new MarkdownIt({
  html: true,
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
enhanceMarkdownWithLocalImages(markdown);

let previewPanel: vscode.WebviewPanel | undefined;
let currentDocUri: vscode.Uri | undefined;
let extensionBaseUri: vscode.Uri | undefined;
let ignoreEditorScrollSyncUntil = 0;
let lastPreviewToEditorSyncAt = 0;

let cachedPreviewThemeCss: string;
let cachedPreviewThemeOptions: string;
let cachedPreviewThemeIdsJson: string;
let cachedPreviewThemeClassNamesJson: string;
let cachedPreviewMermaidModeByThemeJson: string;
let cachedMermaidScriptContent: string;

type MarkdownRenderEnv = {
  headingSlugs?: Map<string, number>;
  documentUri?: vscode.Uri;
  webview?: vscode.Webview;
};

export function activate(context: vscode.ExtensionContext): void {
  extensionBaseUri = context.extensionUri;

  cachedPreviewThemeCss = buildPreviewThemeCss();
  cachedPreviewThemeOptions = buildPreviewThemeOptionsHtml();
  cachedPreviewThemeIdsJson = JSON.stringify(PREVIEW_THEME_IDS);
  cachedPreviewThemeClassNamesJson = JSON.stringify(PREVIEW_THEME_CLASS_NAMES);
  cachedPreviewMermaidModeByThemeJson = JSON.stringify(PREVIEW_THEME_MERMAID_MODE);

  const mermaidPath = vscode.Uri.joinPath(
    context.extensionUri,
    "node_modules",
    "mermaid",
    "dist",
    "mermaid.min.js"
  ).fsPath;
  try {
    cachedMermaidScriptContent = fs.readFileSync(mermaidPath, "utf-8");
  } catch {
    cachedMermaidScriptContent = "";
  }

  const openPreviewCmd = vscode.commands.registerCommand(
    OPEN_PREVIEW_COMMAND,
    async (uri?: vscode.Uri) => {
      const document = await resolveMarkdownDocument(uri);
      if (!document) {
        vscode.window.showWarningMessage("Please select a Markdown file first.");
        return;
      }

      openPreviewForDocument(document, context);
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

  const customEditorProvider = vscode.window.registerCustomEditorProvider(
    CUSTOM_EDITOR_VIEW_TYPE,
    new BeautifulMarkdownPreviewEditorProvider(context),
    {
      webviewOptions: {
        retainContextWhenHidden: true
      },
      supportsMultipleEditorsPerDocument: false
    }
  );

  context.subscriptions.push(
    openPreviewCmd,
    docChange,
    activeEditorChange,
    visibleRangeChange,
    codeLensProvider,
    customEditorProvider
  );
}

export function deactivate(): void {}

async function resolveMarkdownDocument(
  uri?: vscode.Uri
): Promise<vscode.TextDocument | undefined> {
  if (uri instanceof vscode.Uri) {
    const document = await vscode.workspace.openTextDocument(uri);
    if (document.languageId !== "markdown") {
      return undefined;
    }
    return document;
  }

  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== "markdown") {
    return undefined;
  }
  return editor.document;
}

function openPreviewForDocument(
  document: vscode.TextDocument,
  context: vscode.ExtensionContext
): void {
  currentDocUri = document.uri;

  if (previewPanel) {
    previewPanel.reveal(vscode.ViewColumn.Beside);
    updatePreview(previewPanel, document);
    const editor = getCurrentMarkdownEditor();
    if (editor) {
      syncPreviewScrollFromEditor(editor, 80);
    }
    return;
  }

  previewPanel = vscode.window.createWebviewPanel(
    "beautifulMarkdownPreview",
    `Preview: ${document.fileName.split("/").pop()}`,
    vscode.ViewColumn.Beside,
    getPreviewWebviewOptions(document, context.extensionUri)
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

  updatePreview(previewPanel, document);
  const editor = getCurrentMarkdownEditor();
  if (editor) {
    syncPreviewScrollFromEditor(editor, 120);
  }

  previewPanel.onDidDispose(
    () => {
      previewPanel = undefined;
      currentDocUri = undefined;
    },
    null,
    context.subscriptions
  );
}

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

class BeautifulMarkdownPreviewEditorProvider implements vscode.CustomTextEditorProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): void {
    webviewPanel.webview.options = getPreviewWebviewOptions(
      document,
      this.context.extensionUri
    );

    const render = (): void => {
      updatePreview(webviewPanel, document);
    };

    render();

    const changeSubscription = vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.toString() === document.uri.toString()) {
        render();
      }
    });

    webviewPanel.onDidDispose(() => {
      changeSubscription.dispose();
    });
  }
}

function updatePreview(panel: vscode.WebviewPanel, document: vscode.TextDocument): void {
  if (!extensionBaseUri) {
    return;
  }
  panel.webview.options = getPreviewWebviewOptions(document, extensionBaseUri);
  const env: MarkdownRenderEnv = {
    headingSlugs: new Map(),
    documentUri: document.uri,
    webview: panel.webview
  };
  const rendered = rewriteHtmlImageSources(
    markdown.render(document.getText(), env),
    document.uri,
    panel.webview
  );
  const fileName = document.fileName.split("/").pop() ?? "Markdown";
  panel.title = `Preview: ${fileName}`;
  panel.webview.html = getWebviewContent(
    panel.webview,
    rendered,
    fileName,
    extensionBaseUri,
    document.uri
  );
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
  extensionUri: vscode.Uri,
  documentUri: vscode.Uri
): string {
  const nonce = getNonce();
  const previewThemeCss = cachedPreviewThemeCss;
  const previewThemeOptions = cachedPreviewThemeOptions;
  const previewThemeIdsJson = cachedPreviewThemeIdsJson;
  const previewThemeClassNamesJson = cachedPreviewThemeClassNamesJson;
  const previewMermaidModeByThemeJson = cachedPreviewMermaidModeByThemeJson;

  const mermaidScript = cachedMermaidScriptContent
    ? `<script nonce="${nonce}">${cachedMermaidScriptContent}</script>`
    : `<script src="${webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, "node_modules", "mermaid", "dist", "mermaid.min.js")
      )}"></script>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta
    http-equiv="Content-Security-Policy"
    content="default-src 'none'; img-src 'self' ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'nonce-${nonce}';"
  />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <base href="${escapeHtml(getWebviewBaseHref(webview, documentUri))}" />
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
      scroll-margin-top: 40px;
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
      height: auto;
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
    .back-to-top {
      position: fixed;
      right: 20px;
      bottom: 24px;
      z-index: 32;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 42px;
      height: 42px;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: var(--topbar-bg);
      color: var(--text-main);
      box-shadow: 0 4px 16px color-mix(in srgb, var(--text-main) 12%, transparent);
      cursor: pointer;
      opacity: 0;
      visibility: hidden;
      transform: translateY(12px);
      transition: opacity 180ms ease, transform 180ms ease, visibility 180ms ease, background-color 180ms ease;
      backdrop-filter: blur(8px);
    }
    .back-to-top:hover {
      background: var(--surface);
      color: var(--link);
    }
    .back-to-top.visible {
      opacity: 1;
      visibility: visible;
      transform: translateY(0);
    }
    .back-to-top svg {
      width: 18px;
      height: 18px;
      stroke: currentColor;
      fill: none;
      stroke-width: 2.2;
      stroke-linecap: round;
      stroke-linejoin: round;
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
  <button type="button" class="back-to-top" id="backToTop" aria-label="Back to top" title="Back to top">
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 19V5"></path>
      <path d="M5 12l7-7 7 7"></path>
    </svg>
  </button>

  ${mermaidScript}
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const themeSelect = document.getElementById("themeSelect");
    const topbar = document.querySelector(".topbar");
    const topbarRevealZone = document.querySelector(".topbar-reveal-zone");
    const backToTopButton = document.getElementById("backToTop");
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
    if (!localStorage.getItem("bmp-topbar-hint")) {
      showTopbarTemporarily(2000);
      localStorage.setItem("bmp-topbar-hint", "1");
    }

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

    function updateBackToTopVisibility() {
      if (!backToTopButton) {
        return;
      }

      const showBackToTop = window.scrollY > window.innerHeight;
      backToTopButton.classList.toggle("visible", showBackToTop);
    }

    function getSourceLineFromElement(element) {
      let node = element;
      while (node) {
        const line = Number(node.getAttribute("data-source-line"));
        if (Number.isFinite(line)) {
          return line;
        }
        node = node.parentElement;
      }
      return undefined;
    }

    function postEditorScrollSync(lineOverride) {
      ignorePreviewScrollSyncUntil = Date.now() + 90;
      const payload = getPreviewScrollPayload();
      if (typeof lineOverride === "number" && Number.isFinite(lineOverride)) {
        payload.line = lineOverride;
      }

      lastPostedScrollAt = Date.now();
      lastPostedScrollLine = payload.line;
      vscode.postMessage({
        type: "previewScrolled",
        ...payload
      });
    }

    backToTopButton?.addEventListener("click", () => {
      window.scrollTo({ top: 0, behavior: "auto" });
      updateBackToTopVisibility();
      postEditorScrollSync(0);
    });

    updateBackToTopVisibility();

    document.addEventListener("click", (event) => {
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!link) {
        return;
      }

      const href = link.getAttribute("href");
      if (!href || !href.startsWith("#") || href.length < 2) {
        return;
      }

      event.preventDefault();
      const rawId = decodeURIComponent(href.slice(1));
      const target = document.getElementById(rawId);
      if (!target) {
        return;
      }

      target.scrollIntoView({ behavior: "auto", block: "start" });
      postEditorScrollSync(getSourceLineFromElement(target));
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
      updateBackToTopVisibility();

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

function slugifyHeading(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function uniqueHeadingSlug(slug: string, env: { headingSlugs?: Map<string, number> }): string {
  if (!env.headingSlugs) {
    env.headingSlugs = new Map();
  }

  const baseSlug = slug || "heading";
  const count = env.headingSlugs.get(baseSlug) ?? 0;
  env.headingSlugs.set(baseSlug, count + 1);
  return count === 0 ? baseSlug : `${baseSlug}-${count}`;
}

function getPreviewWebviewOptions(
  document: vscode.TextDocument,
  extensionUri: vscode.Uri
): vscode.WebviewOptions {
  return {
    enableScripts: true,
    localResourceRoots: getLocalResourceRoots(document, extensionUri)
  };
}

function getLocalResourceRoots(
  document: vscode.TextDocument,
  extensionUri: vscode.Uri
): vscode.Uri[] {
  const roots: vscode.Uri[] = [vscode.Uri.joinPath(extensionUri, "node_modules")];
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (workspaceFolders) {
    for (const folder of workspaceFolders) {
      roots.push(folder.uri);
    }
  }
  if (document.uri.scheme === "file") {
    roots.push(vscode.Uri.file(path.dirname(document.uri.fsPath)));
  }

  return roots;
}

function getWebviewBaseHref(webview: vscode.Webview, documentUri: vscode.Uri): string {
  const dirUri =
    documentUri.scheme === "file"
      ? vscode.Uri.file(path.dirname(documentUri.fsPath))
      : vscode.Uri.joinPath(documentUri, "..");
  const href = webview.asWebviewUri(dirUri).toString();
  if (href.endsWith("/")) {
    return href;
  }
  return `${href}/`;
}

function rewriteHtmlImageSources(
  html: string,
  documentUri: vscode.Uri,
  webview: vscode.Webview
): string {
  return html.replace(
    /<img\b([^>]*?)\bsrc\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi,
    (_match: string, before: string, rawSrc: string) => {
      const src = unwrapHtmlAttrValue(rawSrc);
      const rewritten = rewriteMarkdownImageSrc(src, documentUri, webview);
      return `<img${before}src="${escapeHtml(rewritten)}"`;
    }
  );
}

function unwrapHtmlAttrValue(raw: string): string {
  if (raw.length >= 2) {
    const quote = raw[0];
    if ((quote === '"' || quote === "'") && raw[raw.length - 1] === quote) {
      return raw.slice(1, -1);
    }
  }
  return raw;
}

function enhanceMarkdownWithLocalImages(md: MarkdownIt): void {
  const defaultImageRule = md.renderer.rules.image;
  md.renderer.rules.image = (tokens: any[], idx: number, options: any, env: MarkdownRenderEnv, self: any): string => {
    const token = tokens[idx];
    const src = token.attrGet("src");
    if (src && env.webview && env.documentUri) {
      token.attrSet("src", rewriteMarkdownImageSrc(src, env.documentUri, env.webview));
    }

    if (defaultImageRule) {
      return defaultImageRule(tokens, idx, options, env, self);
    }
    return self.renderToken(tokens, idx, options);
  };
}

function rewriteMarkdownImageSrc(
  src: string,
  documentUri: vscode.Uri,
  webview: vscode.Webview
): string {
  try {
    if (/^https?:/i.test(src) || /^data:/i.test(src)) {
      return src;
    }

    if (/^file:/i.test(src)) {
      return webview.asWebviewUri(vscode.Uri.parse(src)).toString(true);
    }

    if (/^[a-z][a-z0-9+.-]*:/i.test(src)) {
      return src;
    }

    const resourceUri = resolveLocalMarkdownUri(src, documentUri);
    return webview.asWebviewUri(resourceUri).toString(true);
  } catch {
    return src;
  }
}

function resolveLocalMarkdownUri(href: string, documentUri: vscode.Uri): vscode.Uri {
  let decodedHref = href;
  try {
    decodedHref = decodeURI(href);
  } catch {
    decodedHref = href;
  }

  const queryIndex = decodedHref.search(/[?#]/);
  const pathOnly = queryIndex === -1 ? decodedHref : decodedHref.slice(0, queryIndex);

  if (/^[a-zA-Z]:[\\/]/.test(pathOnly)) {
    return vscode.Uri.file(pathOnly);
  }

  if (pathOnly.startsWith("/")) {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(documentUri);
    if (workspaceFolder) {
      return vscode.Uri.joinPath(workspaceFolder.uri, pathOnly.replace(/^[\\/]+/, ""));
    }
    return vscode.Uri.file(pathOnly);
  }

  if (documentUri.scheme === "file") {
    return vscode.Uri.file(path.normalize(path.join(path.dirname(documentUri.fsPath), pathOnly)));
  }

  return vscode.Uri.joinPath(documentUri, "..", pathOnly);
}

function enhanceMarkdownWithSourceLineAnchors(md: MarkdownIt): void {
  const defaultHeadingOpenRule = md.renderer.rules.heading_open;
  md.renderer.rules.heading_open = (tokens: any[], idx: number, options: any, env: any, self: any): string => {
    const token = tokens[idx];
    const startLine = token?.map?.[0];
    if (Number.isInteger(startLine) && typeof token.attrSet === "function") {
      token.attrSet("data-source-line", String(startLine));
    }

    const inlineToken = tokens[idx + 1];
    if (inlineToken?.type === "inline" && typeof inlineToken.content === "string") {
      const slug = slugifyHeading(inlineToken.content);
      if (slug && typeof token.attrSet === "function" && !token.attrGet("id")) {
        token.attrSet("id", uniqueHeadingSlug(slug, env));
      }
    }

    if (defaultHeadingOpenRule) {
      return defaultHeadingOpenRule(tokens, idx, options, env, self);
    }
    return self.renderToken(tokens, idx, options);
  };

  const blockOpenRules = [
    "paragraph_open",
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
