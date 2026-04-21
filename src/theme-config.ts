export type MermaidThemeMode = "auto" | "default" | "dark";

export interface PreviewThemeConfig {
  id: string;
  label: string;
  mermaidTheme: MermaidThemeMode;
  css: string;
}

export const DEFAULT_PREVIEW_THEME_ID = "studio-sync";

export const PREVIEW_THEMES: PreviewThemeConfig[] = [
  {
    id: "studio-sync",
    label: "Studio Sync (Default)",
    mermaidTheme: "auto",
    css: `
body.theme-studio-sync {
  --text-main: var(--vscode-editor-foreground);
  --heading: var(--vscode-editor-foreground);
  --emphasis: var(--vscode-editor-foreground);
  --link: var(--vscode-textLink-foreground, #3794ff);
  --border: var(--vscode-panel-border, var(--vscode-editorWidget-border, rgba(127, 127, 127, 0.45)));
  --surface: var(--vscode-editor-background);
  --topbar-bg: color-mix(in srgb, var(--vscode-sideBar-background, var(--vscode-editor-background)) 92%, transparent);
  --quote-bg: var(--vscode-editorHoverWidget-background, var(--vscode-textCodeBlock-background, rgba(127, 127, 127, 0.12)));
  --quote-border: var(--vscode-focusBorder, #3794ff);
  --table-head-bg: var(--vscode-editorHoverWidget-background, var(--vscode-textCodeBlock-background, rgba(127, 127, 127, 0.12)));
  --inline-code-bg: var(--vscode-textCodeBlock-background, rgba(127, 127, 127, 0.12));
  --inline-code-text: var(--vscode-symbolIcon-variableForeground, var(--vscode-editor-foreground));
  --code-bg: var(--vscode-editorHoverWidget-background, var(--vscode-textCodeBlock-background, rgba(127, 127, 127, 0.12)));
  --code-border: var(--vscode-panel-border, var(--vscode-editorWidget-border, rgba(127, 127, 127, 0.45)));
  --code-text: var(--vscode-editor-foreground);
  --syntax-keyword: var(--vscode-symbolIcon-keywordForeground, #c586c0);
  --syntax-string: var(--vscode-symbolIcon-stringForeground, #ce9178);
  --syntax-number: var(--vscode-symbolIcon-numberForeground, #b5cea8);
  --syntax-comment: var(--vscode-descriptionForeground, #6a9955);
  background:
    radial-gradient(circle at top, rgba(99, 102, 241, 0.08) 0%, transparent 45%),
    var(--vscode-editor-background);
  color: var(--text-main);
}
body.vscode-dark.theme-studio-sync,
body.vscode-high-contrast.theme-studio-sync {
  --quote-border: #7aa2ff;
}
body.vscode-light.theme-studio-sync {
  --quote-border: #2f63d8;
}
`
  },
  {
    id: "aurora",
    label: "Aurora (Light)",
    mermaidTheme: "default",
    css: `
body.theme-aurora {
  --text-main: #1c1e22;
  --heading: #0f172a;
  --emphasis: #1f2937;
  --link: #2563eb;
  --border: #e5e7eb;
  --surface: #ffffff;
  --topbar-bg: rgba(255, 255, 255, 0.75);
  --quote-bg: #f8fafc;
  --quote-border: #60a5fa;
  --table-head-bg: #f8fafc;
  --inline-code-bg: #eef2ff;
  --inline-code-text: #3730a3;
  --code-bg: #0f172a;
  --code-border: #1f2937;
  --code-text: #dbeafe;
  --syntax-keyword: #c084fc;
  --syntax-string: #6ee7b7;
  --syntax-number: #fca5a5;
  --syntax-comment: #94a3b8;
  background: linear-gradient(180deg, #f7fbff 0%, #ffffff 220px);
  color: var(--text-main);
}
`
  },
  {
    id: "paper",
    label: "Paper (Warm)",
    mermaidTheme: "default",
    css: `
body.theme-paper {
  --text-main: #3d2f1f;
  --heading: #2f2418;
  --emphasis: #4a3520;
  --link: #b45309;
  --border: #e7dcc8;
  --surface: #fffaf0;
  --topbar-bg: rgba(255, 250, 240, 0.82);
  --quote-bg: #fff5df;
  --quote-border: #f59e0b;
  --table-head-bg: #fff5df;
  --inline-code-bg: #faedd3;
  --inline-code-text: #7c2d12;
  --code-bg: #3b3226;
  --code-border: #4b3f31;
  --code-text: #f7f1df;
  --syntax-keyword: #fca5a5;
  --syntax-string: #86efac;
  --syntax-number: #fdba74;
  --syntax-comment: #cbd5e1;
  background: #fffdf7;
  color: var(--text-main);
}
`
  },
  {
    id: "midnight",
    label: "Midnight (Dark)",
    mermaidTheme: "dark",
    css: `
body.theme-midnight {
  --text-main: #dbe2f0;
  --heading: #f5f8ff;
  --emphasis: #c7d8ff;
  --link: #93c5fd;
  --border: #25314a;
  --surface: #0f172a;
  --topbar-bg: rgba(10, 18, 36, 0.8);
  --quote-bg: #111a30;
  --quote-border: #60a5fa;
  --table-head-bg: #111a30;
  --inline-code-bg: #1b2640;
  --inline-code-text: #bfdbfe;
  --code-bg: #020817;
  --code-border: #1e293b;
  --code-text: #dbe2f0;
  --syntax-keyword: #c4b5fd;
  --syntax-string: #6ee7b7;
  --syntax-number: #fdba74;
  --syntax-comment: #7c8db1;
  background: radial-gradient(circle at top, #13203d 0%, #070d1b 45%, #050a16 100%);
  color: var(--text-main);
}
`
  },
  {
    id: "forest",
    label: "Forest (Dark Green)",
    mermaidTheme: "dark",
    css: `
body.theme-forest {
  --text-main: #e7efe9;
  --heading: #f4fbf5;
  --emphasis: #d3f4dd;
  --link: #a7f3d0;
  --border: #28513f;
  --surface: #0f2d23;
  --topbar-bg: rgba(8, 36, 29, 0.8);
  --quote-bg: #12382d;
  --quote-border: #34d399;
  --table-head-bg: #12382d;
  --inline-code-bg: #154636;
  --inline-code-text: #a7f3d0;
  --code-bg: #0b2119;
  --code-border: #28513f;
  --code-text: #d3f4dd;
  --syntax-keyword: #a7f3d0;
  --syntax-string: #86efac;
  --syntax-number: #fde68a;
  --syntax-comment: #86a89a;
  background: linear-gradient(180deg, #0c2b22 0%, #071b15 100%);
  color: var(--text-main);
}
`
  },
  {
    id: "sakura",
    label: "Sakura (Soft Pink)",
    mermaidTheme: "default",
    css: `
body.theme-sakura {
  --text-main: #3f2d39;
  --heading: #2e1f2a;
  --emphasis: #5a3f50;
  --link: #be185d;
  --border: #f2d6e3;
  --surface: #fff7fb;
  --topbar-bg: rgba(255, 247, 251, 0.82);
  --quote-bg: #fff1f7;
  --quote-border: #f472b6;
  --table-head-bg: #fff1f7;
  --inline-code-bg: #fde7f3;
  --inline-code-text: #9d174d;
  --code-bg: #3c2433;
  --code-border: #5b3a4d;
  --code-text: #ffe7f5;
  --syntax-keyword: #f9a8d4;
  --syntax-string: #86efac;
  --syntax-number: #fdba74;
  --syntax-comment: #cbd5e1;
  background: linear-gradient(180deg, #fff8fc 0%, #fff2f9 220px, #fff7fb 100%);
  color: var(--text-main);
}
`
  },
  {
    id: "graphite",
    label: "Graphite (Dark Gray)",
    mermaidTheme: "dark",
    css: `
body.theme-graphite {
  --text-main: #e5e7eb;
  --heading: #f9fafb;
  --emphasis: #d1d5db;
  --link: #93c5fd;
  --border: #374151;
  --surface: #111827;
  --topbar-bg: rgba(17, 24, 39, 0.82);
  --quote-bg: #1f2937;
  --quote-border: #60a5fa;
  --table-head-bg: #1f2937;
  --inline-code-bg: #273449;
  --inline-code-text: #bfdbfe;
  --code-bg: #030712;
  --code-border: #374151;
  --code-text: #e5e7eb;
  --syntax-keyword: #c4b5fd;
  --syntax-string: #6ee7b7;
  --syntax-number: #fda4af;
  --syntax-comment: #9ca3af;
  background: linear-gradient(180deg, #1b2433 0%, #111827 100%);
  color: var(--text-main);
}
`
  },
  {
    id: "ocean",
    label: "Ocean (Deep Blue)",
    mermaidTheme: "dark",
    css: `
body.theme-ocean {
  --text-main: #e0f2fe;
  --heading: #f0f9ff;
  --emphasis: #bae6fd;
  --link: #7dd3fc;
  --border: #1d4f6e;
  --surface: #082f49;
  --topbar-bg: rgba(6, 35, 55, 0.82);
  --quote-bg: #0b3957;
  --quote-border: #38bdf8;
  --table-head-bg: #0b3957;
  --inline-code-bg: #114c73;
  --inline-code-text: #bae6fd;
  --code-bg: #041a2b;
  --code-border: #1d4f6e;
  --code-text: #e0f2fe;
  --syntax-keyword: #a5b4fc;
  --syntax-string: #67e8f9;
  --syntax-number: #fcd34d;
  --syntax-comment: #94a3b8;
  background: radial-gradient(circle at top, #0b4f7a 0%, #073a5a 45%, #04263d 100%);
  color: var(--text-main);
}
`
  }
];

export const PREVIEW_THEME_IDS = PREVIEW_THEMES.map((theme) => theme.id);
export const PREVIEW_THEME_CLASS_NAMES = PREVIEW_THEME_IDS.map((id) => `theme-${id}`);
export const PREVIEW_THEME_MERMAID_MODE: Record<string, MermaidThemeMode> = Object.fromEntries(
  PREVIEW_THEMES.map((theme) => [theme.id, theme.mermaidTheme])
);

export function buildPreviewThemeCss(): string {
  return PREVIEW_THEMES.map((theme) => theme.css.trim()).join("\n\n");
}

export function buildPreviewThemeOptionsHtml(): string {
  return PREVIEW_THEMES.map((theme) => `<option value="${theme.id}">${theme.label}</option>`).join("\n");
}
