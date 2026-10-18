// CodeMirror editor color themes (#1309) - LIGHT metadata only (no @uiw import).
// The heavy id->Extension mapping lives in editor-theme-extensions.ts and is imported
// only client-side (CodeEditor / EditorThemeSelector). Server routes import this module
// to validate an id string, so it must stay free of any CodeMirror weight.

export interface EditorThemeMeta {
	id: string;
	label: string;
	dark: boolean;
}

// Built-in first, then dark, then light. Ids are persisted (per-user/global) - keep stable.
export const EDITOR_THEMES: EditorThemeMeta[] = [
	{ id: 'default', label: '默认 (跟随应用主题)', dark: true },

	// Dark
	{ id: 'dracula', label: 'Dracula', dark: true },
    { id: 'vscode-dark', label: 'VS Code 深色', dark: true },
    { id: 'github-dark', label: 'GitHub 深色', dark: true },
    { id: 'monokai', label: 'Monokai', dark: true },
    { id: 'monokai-dimmed', label: 'Monokai Dimmed', dark: true },
    { id: 'nord', label: 'Nord', dark: true },
    { id: 'tokyo-night', label: 'Tokyo Night', dark: true },
    { id: 'tokyo-night-storm', label: 'Tokyo Night Storm', dark: true },
    { id: 'solarized-dark', label: 'Solarized 深色', dark: true },
    { id: 'gruvbox-dark', label: 'Gruvbox 深色', dark: true },
    { id: 'material-dark', label: 'Material 深色', dark: true },
    { id: 'atom-one', label: 'Atom One', dark: true },
    { id: 'androidstudio', label: 'Android Studio', dark: true },
    { id: 'andromeda', label: 'Andromeda', dark: true },
    { id: 'aura', label: 'Aura', dark: true },
    { id: 'abcdef', label: 'abcdef', dark: true },
    { id: 'abyss', label: 'Abyss', dark: true },
    { id: 'bespin', label: 'Bespin', dark: true },
    { id: 'copilot', label: 'Copilot', dark: true },
    { id: 'darcula', label: 'Darcula', dark: true },
    { id: 'duotone-dark', label: 'Duotone 深色', dark: true },
    { id: 'kimbie', label: 'Kimbie', dark: true },
    { id: 'okaidia', label: 'Okaidia', dark: true },
    { id: 'red', label: 'Red', dark: true },
    { id: 'sublime', label: 'Sublime', dark: true },
    { id: 'console-dark', label: '控制台深色', dark: true },
    { id: 'tomorrow-night-blue', label: 'Tomorrow Night Blue', dark: true },
    { id: 'white-dark', label: 'White Dark', dark: true },
    { id: 'xcode-dark', label: 'Xcode 深色', dark: true },
    { id: 'material', label: 'Material', dark: true },
    { id: 'basic-dark', label: '基础深色', dark: true },
	// Light
	{ id: 'github-light', label: 'GitHub 浅色', dark: false },
    { id: 'vscode-light', label: 'VS Code 浅色', dark: false },
    { id: 'solarized-light', label: 'Solarized 浅色', dark: false },
    { id: 'gruvbox-light', label: 'Gruvbox 浅色', dark: false },
    { id: 'material-light', label: 'Material 浅色', dark: false },
    { id: 'duotone-light', label: 'Duotone 浅色', dark: false },
    { id: 'eclipse', label: 'Eclipse', dark: false },
    { id: 'bbedit', label: 'BBEdit', dark: false },
    { id: 'noctis-lilac', label: 'Noctis Lilac', dark: false },
    { id: 'quietlight', label: 'Quiet Light', dark: false },
    { id: 'tokyo-night-day', label: 'Tokyo Night Day', dark: false },
    { id: 'xcode-light', label: 'Xcode 浅色', dark: false },
	{ id: 'console-light', label: 'Console Light', dark: false },
	{ id: 'white-light', label: 'White Light', dark: false }
];

export const EDITOR_THEME_IDS: string[] = EDITOR_THEMES.map((t) => t.id);
const ID_SET = new Set(EDITOR_THEME_IDS);
const META_BY_ID = new Map(EDITOR_THEMES.map((t) => [t.id, t]));

export function getEditorThemeMeta(id: string | undefined | null): EditorThemeMeta {
	return META_BY_ID.get(id ?? 'default') ?? EDITOR_THEMES[0];
}

export function isValidEditorThemeId(id: unknown): id is string {
	return typeof id === 'string' && ID_SET.has(id);
}
