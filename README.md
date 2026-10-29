# mcp-list-paginator

Stable, bounded, opaque-cursor pages for Model Context Protocol list handlers. It is a zero-dependency Node.js primitive for servers using low-level list handlers.

MCP list results can include `nextCursor`, but some high-level server APIs still return every registered tool, resource, template, or prompt at once. This package snapshots one list, returns bounded pages, and keeps cursors opaque to clients.

## Install

```sh
npm install mcp-list-paginator
```

Node.js 18 or newer is required. ESM, CommonJS, and TypeScript declarations are included.

## Quick start

```js
import { createListPaginator } from 'mcp-list-paginator';

const paginator = createListPaginator({ pageSize: 100 });

function listTools(request) {
  const params = request.params ?? {};
  const page = Object.hasOwn(params, 'cursor')
    ? paginator.page({ cursor: params.cursor })
    : paginator.page({ items: getVisibleTools() });

  return {
    tools: page.items,
    ...(page.nextCursor && { nextCursor: page.nextCursor })
  };
}
```

Check whether the `cursor` property was supplied rather than whether its value
is truthy. An explicitly supplied empty string is an invalid cursor; it must not
silently start a new snapshot.

### Low-level TypeScript SDK handlers

The official SDK's low-level `Server` supports custom handlers for all four
standard list operations. Register one paginator per operation and
authorization scope, filter visible entries before the first page, and map
invalid cursors to `InvalidParams`:

```js
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { PaginationCursorError, createListPaginator } from 'mcp-list-paginator';

const toolsByScope = new Map();
const paginatorsByScope = new Map();

server.setRequestHandler(ListToolsRequestSchema, (request, extra) => {
  // Application-defined key for one stable visibility set. Include every
  // tenant, principal, resource, and effective-permission input used by
  // getVisibleTools(); do not key by a bearer token.
  const scope = getAuthorizationScopeKey(extra);
  const params = request.params ?? {};
  const paginator = paginatorsByScope.get(scope)
    ?? paginatorsByScope.set(scope, createListPaginator()).get(scope);

  try {
    const page = Object.hasOwn(params, 'cursor')
      ? paginator.page({ cursor: params.cursor })
      : paginator.page({ items: toolsByScope.get(scope) ?? [] });
    return { tools: page.items, ...(page.nextCursor && { nextCursor: page.nextCursor }) };
  } catch (error) {
    if (error instanceof PaginationCursorError || error instanceof TypeError) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid pagination cursor');
    }
    throw error;
  }
});
```

Apply the same pattern to `resources/list`, `resources/templates/list`, and
`prompts/list`. Call `clear()` and discard that scope's paginator when
authorization is revoked. A raw client ID is only sufficient when the
application guarantees that it identifies exactly one visibility set. The
integration suite exercises real SDK clients, all four list methods, traversal,
invalid-parameter mapping, scope isolation, and revocation.

See [`examples/mcp-handler.mjs`](examples/mcp-handler.mjs) for a runnable example.

## API

### `createListPaginator(options?)`

Creates independent in-memory pagination state.

- `pageSize` — items per page; default `100`, range 1–10,000.
- `maxSnapshots` — maximum concurrent list snapshots; default `100`, range 1–10,000. Starting another snapshot evicts the oldest when full.
- `maxItems` — maximum retained items in one snapshot; default `100,000`, range 1–1,000,000. Larger inputs are rejected before retention.
- `ttlMs` — snapshot lifetime; default five minutes, maximum 2,147,483,647 ms.
- `now` and `createToken` — deterministic testing hooks. Production code should keep the secure defaults. `createToken` generates cursor strings only; internal snapshot identities are independent. Tokens must be strings of at least 16 characters. Live cursor collisions are retried up to ten attempts, then rejected.

### `paginator.page(request)`

Start with `{ items }`; continue with `{ cursor }`. Supplying both or neither is rejected. Results contain `items` and, while another page exists, `nextCursor`.

If initial cursor generation fails, no new snapshot is retained and existing unexpired snapshots are not evicted. Failed continuation cursor generation leaves the current cursor retryable.

The input array is shallow-copied on the first call so later array insertions, removals, or reordering do not shift the active walk. Item objects themselves are not deep-cloned.

### `paginator.clear()`

Invalidates all cursors and returns the number of removed snapshots. This is useful during shutdown or catalog invalidation.

### `paginator.stats()`

Returns frozen operational counts and configured bounds. It never exposes cursors or catalog items.

### `PaginationCursorError`

An unknown, expired, evicted, or cleared cursor throws this error with code `MCP_PAGINATION_CURSOR_INVALID`. The intentionally uniform message avoids turning cursor handling into a state oracle.

## CommonJS

```js
const { createListPaginator } = require('mcp-list-paginator');
```

## Limits and security model

- State is process-local and is not shared between workers. Use sticky routing or create a shared-store implementation for horizontally scaled servers.
- Restarting the process invalidates cursors.
- Expiry is lazy: no background timers are created. Normal `page()` and `stats()` calls purge expired state.
- Cursors are 192-bit random opaque tokens by default, but they are bearer capabilities—not authentication. Apply the same authorization checks on every page request, and use separate paginator instances per authorization scope when catalog visibility differs between callers.
- The snapshot retains shallow item references until expiry or eviction. Choose bounds appropriate for catalog size and memory budget.
- The helper does not register MCP handlers or depend on a particular SDK version. It only supplies page state and results.

## Troubleshooting

**A cursor fails after another request.** The snapshot may have expired, been evicted by `maxSnapshots`, been cleared, or belonged to a different process. Return the protocol-appropriate invalid-params error and let the client restart the list operation.

**Changes do not appear on later pages.** This is deliberate snapshot stability. A new list request without a cursor captures the current catalog.

**A user's permissions changed mid-pagination.** Invalidate the affected scope with `clear()` or replace its paginator. Do not return an old visibility snapshot after access is revoked.

**Multiple server replicas reject each other's cursors.** Route the pagination sequence to one replica or use shared state; this package intentionally has no database dependency.

**The high-level SDK still returns the full list.** This package cannot replace a handler hidden inside a high-level server abstraction. Use a low-level list handler or wait for native pagination support.

## Why this exists

The MCP specification defines cursor pagination, while [modelcontextprotocol/typescript-sdk#2352](https://github.com/modelcontextprotocol/typescript-sdk/issues/2352) documents missing server-side pagination in its high-level `McpServer` list operations. Existing npm search results are largely UI, ORM, and database pagination tools; this package focuses only on bounded MCP list-handler state.

## Development

```sh
npm ci --ignore-scripts
npm run check
```

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and [CHANGELOG.md](CHANGELOG.md).

## License

MIT © Huzaifa Asif
