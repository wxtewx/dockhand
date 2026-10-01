/**
 * DataGrid Context
 *
 * Provides shared state to child components via Svelte context.
 */

import { getContext, setContext } from 'svelte';
import type { DataGridContext } from './types';

const DATA_GRID_CONTEXT_KEY = Symbol('data-grid');

/**
 * Set the DataGrid context (called by DataGrid.svelte)
 */
export function setDataGridContext<T>(ctx: DataGridContext<T>): void {
	setContext(DATA_GRID_CONTEXT_KEY, ctx);
}

/**
 * Get the DataGrid context (called by child components)
 */
export function getDataGridContext<T = unknown>(): DataGridContext<T> {
	const ctx = getContext<DataGridContext<T>>(DATA_GRID_CONTEXT_KEY);
	if (!ctx) {
		throw new Error('未找到 DataGrid 上下文。请确保组件在 DataGrid 内部使用。');
	}
	return ctx;
}
