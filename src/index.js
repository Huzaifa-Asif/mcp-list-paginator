import { randomBytes } from 'node:crypto';

const MAX_INTEGER_OPTION = 10_000;
const MAX_ITEMS_OPTION = 1_000_000;
const MAX_TTL_MS = 2_147_483_647;

export class PaginationCursorError extends Error {
  constructor() {
    super('Pagination cursor is invalid, expired, or no longer retained');
    this.name = 'PaginationCursorError';
    this.code = 'MCP_PAGINATION_CURSOR_INVALID';
  }
}

function integerOption(value, fallback, name, maximum) {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > maximum) {
    throw new TypeError(`${name} must be a positive safe integer no greater than ${maximum}`);
  }
  return resolved;
}

function assertRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new TypeError('request must be an object');
  }
  const hasItems = Object.hasOwn(request, 'items');
  const hasCursor = Object.hasOwn(request, 'cursor');
  if (hasItems === hasCursor) throw new TypeError('request must contain exactly one of items or cursor');
  if (hasItems && !Array.isArray(request.items)) throw new TypeError('request.items must be an array');
  if (hasCursor && (typeof request.cursor !== 'string' || request.cursor.length === 0)) {
    throw new TypeError('request.cursor must be a non-empty string');
  }
}

export function createListPaginator(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('options must be an object');
  const pageSize = integerOption(options.pageSize, 100, 'pageSize', MAX_INTEGER_OPTION);
  const maxSnapshots = integerOption(options.maxSnapshots, 100, 'maxSnapshots', MAX_INTEGER_OPTION);
  const maxItems = integerOption(options.maxItems, 100_000, 'maxItems', MAX_ITEMS_OPTION);
  const ttlMs = integerOption(options.ttlMs, 300_000, 'ttlMs', MAX_TTL_MS);
  const now = options.now ?? Date.now;
  const createToken = options.createToken ?? (() => randomBytes(24).toString('base64url'));
  if (typeof now !== 'function') throw new TypeError('now must be a function');
  if (typeof createToken !== 'function') throw new TypeError('createToken must be a function');

  const snapshots = new Map();
  const cursors = new Map();

  function removeSnapshot(snapshotId) {
    const snapshot = snapshots.get(snapshotId);
    if (!snapshot) return false;
    for (const token of snapshot.tokens) cursors.delete(token);
    snapshots.delete(snapshotId);
    return true;
  }

  function cleanup(at) {
    for (const [snapshotId, snapshot] of snapshots) {
      if (snapshot.expiresAt <= at) removeSnapshot(snapshotId);
    }
  }

  function uniqueToken() {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const token = createToken();
      if (typeof token !== 'string' || token.length < 16) {
        throw new TypeError('createToken must return a string of at least 16 characters');
      }
      if (!cursors.has(token)) return token;
    }
    throw new Error('createToken repeatedly returned duplicate cursors');
  }

  function cursorFor(snapshot, offset) {
    const token = uniqueToken();
    snapshot.tokens.add(token);
    cursors.set(token, { snapshotId: snapshot.id, offset, nextCursor: undefined });
    return token;
  }

  function resultFor(snapshot, offset, record) {
    const items = snapshot.items.slice(offset, offset + pageSize);
    const nextOffset = offset + items.length;
    let nextCursor;
    if (nextOffset < snapshot.items.length) {
      nextCursor = record?.nextCursor;
      if (!nextCursor) {
        nextCursor = cursorFor(snapshot, nextOffset);
        if (record) record.nextCursor = nextCursor;
      }
    }
    return nextCursor ? { items, nextCursor } : { items };
  }

  function page(request) {
    assertRequest(request);
    const at = now();
    if (!Number.isFinite(at)) throw new TypeError('now must return a finite number');
    cleanup(at);

    if (Object.hasOwn(request, 'items')) {
      const items = Array.from(request.items);
      if (items.length > maxItems) throw new RangeError(`request.items cannot contain more than ${maxItems} items`);
      if (items.length <= pageSize) return { items };
      while (snapshots.size >= maxSnapshots) removeSnapshot(snapshots.keys().next().value);
      const snapshot = { id: uniqueToken(), items, expiresAt: at + ttlMs, tokens: new Set() };
      snapshots.set(snapshot.id, snapshot);
      return resultFor(snapshot, 0);
    }

    const record = cursors.get(request.cursor);
    const snapshot = record && snapshots.get(record.snapshotId);
    if (!record || !snapshot) throw new PaginationCursorError();
    return resultFor(snapshot, record.offset, record);
  }

  function clear() {
    const removed = snapshots.size;
    snapshots.clear();
    cursors.clear();
    return removed;
  }

  function stats() {
    cleanup(now());
    return Object.freeze({ snapshots: snapshots.size, cursors: cursors.size, pageSize, maxSnapshots, maxItems, ttlMs });
  }

  return Object.freeze({ page, clear, stats });
}
