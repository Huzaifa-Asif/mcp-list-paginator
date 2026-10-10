export interface ListPaginatorOptions {
  pageSize?: number;
  maxSnapshots?: number;
  maxItems?: number;
  ttlMs?: number;
  now?: () => number;
  createToken?: () => string;
}

export interface PageResult<T> {
  items: T[];
  nextCursor?: string;
}

export interface ListPaginator<T> {
  page(request: { items: readonly T[]; cursor?: never } | { cursor: string; items?: never }): PageResult<T>;
  clear(): number;
  stats(): Readonly<{ snapshots: number; cursors: number; pageSize: number; maxSnapshots: number; maxItems: number; ttlMs: number }>;
}

export declare class PaginationCursorError extends Error {
  readonly code: 'MCP_PAGINATION_CURSOR_INVALID';
}

export declare function createListPaginator<T = unknown>(options?: ListPaginatorOptions): ListPaginator<T>;
