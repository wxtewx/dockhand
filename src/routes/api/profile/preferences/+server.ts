import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getUserThemePreferences, setUserThemePreferences } from '$lib/server/db';
import { validateSession, isAuthEnabled } from '$lib/server/auth';
import { lightThemes, darkThemes, fonts, monospaceFonts } from '$lib/themes';

// GET /api/profile/preferences - Get current user's theme preferences
export const GET: RequestHandler = async ({ cookies }) => {
	if (!(await isAuthEnabled())) {
		return json({ error: '未启用身份验证' }, { status: 400 });
	}

	const currentUser = await validateSession(cookies);
	if (!currentUser) {
		return json({ error: '未登录' }, { status: 401 });
	}

	try {
		const prefs = await getUserThemePreferences(currentUser.id);
		return json(prefs);
	} catch (error) {
		console.error('获取偏好设置失败:', error);
		return json({ error: '获取偏好设置失败' }, { status: 500 });
	}
};

// PUT /api/profile/preferences - Update current user's theme preferences
export const PUT: RequestHandler = async ({ request, cookies }) => {
	if (!(await isAuthEnabled())) {
		return json({ error: '未启用身份验证' }, { status: 400 });
	}

	const currentUser = await validateSession(cookies);
	if (!currentUser) {
		return json({ error: '未登录' }, { status: 401 });
	}

	try {
		const data = await request.json();

		// Validate theme values using imported theme lists
		const validLightThemeIds = lightThemes.map(t => t.id);
		const validDarkThemeIds = darkThemes.map(t => t.id);
		const validFontIds = fonts.map(f => f.id);
		const validTerminalFontIds = monospaceFonts.map(f => f.id);
		const validFontSizes = ['xsmall', 'small', 'normal', 'medium', 'large', 'xlarge'];

		const updates: { lightTheme?: string; darkTheme?: string; font?: string; fontSize?: string; gridFontSize?: string; terminalFont?: string; editorFont?: string } = {};

		if (data.lightTheme !== undefined) {
			if (!validLightThemeIds.includes(data.lightTheme)) {
				return json({ error: '无效的浅色主题' }, { status: 400 });
			}
			updates.lightTheme = data.lightTheme;
		}

		if (data.darkTheme !== undefined) {
			if (!validDarkThemeIds.includes(data.darkTheme)) {
				return json({ error: '无效的深色主题' }, { status: 400 });
			}
			updates.darkTheme = data.darkTheme;
		}

		if (data.font !== undefined) {
			if (!validFontIds.includes(data.font)) {
				return json({ error: '无效的字体' }, { status: 400 });
			}
			updates.font = data.font;
		}

		if (data.fontSize !== undefined) {
			if (!validFontSizes.includes(data.fontSize)) {
				return json({ error: '无效的字体大小' }, { status: 400 });
			}
			updates.fontSize = data.fontSize;
		}

		if (data.gridFontSize !== undefined) {
			if (!validFontSizes.includes(data.gridFontSize)) {
				return json({ error: '无效的表格字体大小' }, { status: 400 });
			}
			updates.gridFontSize = data.gridFontSize;
		}

		if (data.terminalFont !== undefined) {
			if (!validTerminalFontIds.includes(data.terminalFont)) {
				return json({ error: '无效的终端字体' }, { status: 400 });
			}
			updates.terminalFont = data.terminalFont;
		}

		if (data.editorFont !== undefined) {
			if (!validTerminalFontIds.includes(data.editorFont)) {
				return json({ error: '无效的编辑器字体' }, { status: 400 });
			}
			updates.editorFont = data.editorFont;
		}

		await setUserThemePreferences(currentUser.id, updates);

		// Return updated preferences
		const prefs = await getUserThemePreferences(currentUser.id);
		return json(prefs);
	} catch (error) {
		console.error('更新偏好设置失败:', error);
		return json({ error: '更新偏好设置失败' }, { status: 500 });
	}
};
