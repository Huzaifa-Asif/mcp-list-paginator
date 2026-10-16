import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { PaginationCursorError, createListPaginator } from '../src/index.js';

const require = createRequire(import.meta.url);

function deterministicOptions(overrides = {}) {
  let token = 0;
  return { createToken: () => `token-${String(token += 1).padStart(20, '0')}`, ...overrides };
}

function collect(paginator, values) {
  const output = [];
  let result = paginator.page({ items: values });
  output.push(...result.items);
  while (result.nextCursor) {
    result = paginator.page({ cursor: result.nextCursor });
    output.push(...result.items);
  }
  return output;
}

test('returns small lists without allocating snapshot state', () => {
  const paginator = createListPaginator({ pageSize: 3 });
  assert.deepEqual(paginator.page({ items: [1, 2, 3] }), { items: [1, 2, 3] });
  assert.deepEqual(paginator.stats(), { snapshots: 0, cursors: 0, pageSize: 3, maxSnapshots: 100, maxItems: 100_000, ttlMs: 300_000 });
});

test('paginates a stable shallow snapshot', () => {
  const source = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const paginator = createListPaginator({ pageSize: 2, ...deterministicOptions() });
  const first = paginator.page({ items: source });
  source.push({ id: 4 });
  source.splice(0, 1);
  const second = paginator.page({ cursor: first.nextCursor });
  assert.deepEqual(first.items.map((item) => item.id), [1, 2]);
  assert.deepEqual(second.items.map((item) => item.id), [3]);
  assert.equal(second.nextCursor, undefined);
});

test('replaying a cursor is idempotent and returns the same next cursor', () => {
  const paginator = createListPaginator({ pageSize: 1, ...deterministicOptions() });
  const first = paginator.page({ items: ['a', 'b', 'c'] });
  const left = paginator.page({ cursor: first.nextCursor });
  const right = paginator.page({ cursor: first.nextCursor });
  assert.deepEqual(left, right);
  assert.equal(left.nextCursor, right.nextCursor);
});

test('expires snapshots lazily without timers', () => {
  let now = 10;
  const paginator = createListPaginator({ pageSize: 1, ttlMs: 5, now: () => now, ...deterministicOptions() });
  const first = paginator.page({ items: [1, 2] });
  now = 15;
  assert.throws(() => paginator.page({ cursor: first.nextCursor }), (error) => {
    assert.ok(error instanceof PaginationCursorError);
    assert.equal(error.code, 'MCP_PAGINATION_CURSOR_INVALID');
    return true;
  });
  assert.equal(paginator.stats().snapshots, 0);
});

test('evicts the oldest snapshot at the configured bound', () => {
  const paginator = createListPaginator({ pageSize: 1, maxSnapshots: 1, ...deterministicOptions() });
  const oldPage = paginator.page({ items: ['old-1', 'old-2'] });
  const newPage = paginator.page({ items: ['new-1', 'new-2'] });
  assert.throws(() => paginator.page({ cursor: oldPage.nextCursor }), PaginationCursorError);
  assert.deepEqual(paginator.page({ cursor: newPage.nextCursor }).items, ['new-2']);
});

test('clear invalidates every cursor and reports removed snapshots', () => {
  const paginator = createListPaginator({ pageSize: 1, ...deterministicOptions() });
  const first = paginator.page({ items: [1, 2] });
  paginator.page({ items: [3, 4] });
  assert.equal(paginator.clear(), 2);
  assert.equal(paginator.clear(), 0);
  assert.throws(() => paginator.page({ cursor: first.nextCursor }), PaginationCursorError);
});

test('rejects malformed options and requests', () => {
  for (const options of [null, [], { pageSize: 0 }, { pageSize: 10_001 }, { maxSnapshots: -1 }, { maxItems: 1_000_001 }, { ttlMs: Infinity }, { now: 1 }, { createToken: 1 }]) {
    assert.throws(() => createListPaginator(options), TypeError);
  }
  const paginator = createListPaginator(deterministicOptions());
  for (const request of [null, [], {}, { items: [], cursor: 'x' }, { items: 'x' }, { cursor: '' }, { cursor: 1 }]) {
    assert.throws(() => paginator.page(request), TypeError);
  }
});

test('rejects catalogs above the configured retention bound', () => {
  const paginator = createListPaginator({ pageSize: 1, maxItems: 2 });
  assert.throws(() => paginator.page({ items: [1, 2, 3] }), RangeError);
  assert.equal(paginator.stats().snapshots, 0);
});

test('rejects invalid clocks, short tokens, and repeated token collisions', () => {
  assert.throws(() => createListPaginator({ now: () => NaN }).page({ items: [] }), /finite/);
  assert.throws(() => createListPaginator({ pageSize: 1, createToken: () => 'short' }).page({ items: [1, 2] }), /at least 16/);
  const collision = createListPaginator({ pageSize: 1, createToken: () => 'same-token-value-0000' });
  const first = collision.page({ items: [1, 2, 3] });
  assert.throws(() => collision.page({ cursor: first.nextCursor }), /duplicate/);
});

test('deterministic fuzz preserves order, identity, and cardinality', () => {
  let seed = 0x4d435031;
  const random = () => {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
    return seed / 0x1_0000_0000;
  };
  for (let run = 0; run < 250; run += 1) {
    const length = Math.floor(random() * 200);
    const pageSize = 1 + Math.floor(random() * 25);
    const values = Array.from({ length }, (_, index) => ({ run, index }));
    const paginator = createListPaginator({ pageSize, ...deterministicOptions() });
    assert.deepEqual(collect(paginator, values), values);
  }
});

test('CommonJS and ESM expose matching usable APIs', () => {
  const cjs = require('../src/index.cjs');
  assert.deepEqual(Object.keys(cjs).sort(), ['PaginationCursorError', 'createListPaginator']);
  const paginator = cjs.createListPaginator({ pageSize: 1 });
  assert.deepEqual(paginator.page({ items: ['only'] }), { items: ['only'] });
});

for (const [format, api] of [['ESM', { createListPaginator, PaginationCursorError }], ['CommonJS', require('../src/index.cjs')]]) {
  const token = (letter) => letter.repeat(24);

  test(`${format}: repeated token sequence cannot replace a live snapshot`, () => {
    const tokens = ['A', 'B', 'A', 'C'].map(token);
    const paginator = api.createListPaginator({ pageSize: 1, createToken: () => tokens.shift() });
    const old = paginator.page({ items: ['old-1', 'old-2', 'old-3'] });
    const current = paginator.page({ items: ['new-1', 'new-2'] });
    const second = paginator.page({ cursor: old.nextCursor });
    assert.deepEqual(second.items, ['old-2']);
    assert.deepEqual(paginator.page({ cursor: current.nextCursor }), { items: ['new-2'] });
    assert.deepEqual(paginator.page({ cursor: second.nextCursor }), { items: ['old-3'] });
    assert.deepEqual(paginator.page({ cursor: old.nextCursor }), second);
    assert.equal(tokens.length, 0);
    assert.equal(paginator.stats().snapshots, 2);
    assert.equal(paginator.stats().cursors, 3);
  });

  test(`${format}: ten duplicate attempts fail without evicting or overwriting`, () => {
    let attempts = 0;
    let value = token('A');
    const paginator = api.createListPaginator({ pageSize: 1, maxSnapshots: 1, createToken: () => { attempts += 1; return value; } });
    const old = paginator.page({ items: ['old-1', 'old-2'] });
    const before = paginator.stats();
    assert.throws(() => paginator.page({ items: ['new-1', 'new-2'] }), /duplicate/);
    assert.equal(attempts, 11);
    assert.deepEqual(paginator.stats(), before);
    assert.deepEqual(paginator.page({ cursor: old.nextCursor }), { items: ['old-2'] });
    value = token('B');
    const current = paginator.page({ items: ['new-1', 'new-2'] });
    assert.throws(() => paginator.page({ cursor: old.nextCursor }), api.PaginationCursorError);
    assert.deepEqual(paginator.page({ cursor: current.nextCursor }), { items: ['new-2'] });
  });

  for (const [label, failure] of [
    ['short token', () => 'short'],
    ['non-string token', () => null],
    ['throwing hook', () => { throw new Error('hook failed'); }],
  ]) {
    test(`${format}: ${label} retains no orphan and preserves an existing walk`, () => {
      let generate = failure;
      const paginator = api.createListPaginator({ pageSize: 1, maxSnapshots: 1, createToken: () => generate() });
      assert.throws(() => paginator.page({ items: [1, 2] }));
      assert.equal(paginator.stats().snapshots, 0);
      assert.equal(paginator.stats().cursors, 0);
      generate = () => token('A');
      const old = paginator.page({ items: ['old-1', 'old-2'] });
      const before = paginator.stats();
      generate = failure;
      assert.throws(() => paginator.page({ items: ['new-1', 'new-2'] }));
      assert.deepEqual(paginator.stats(), before);
      assert.deepEqual(paginator.page({ cursor: old.nextCursor }), { items: ['old-2'] });
    });
  }

  test(`${format}: failed continuation can retry and replay after collision exhaustion`, () => {
    let value = token('A');
    const paginator = api.createListPaginator({ pageSize: 1, createToken: () => value });
    const first = paginator.page({ items: [1, 2, 3] });
    const before = paginator.stats();
    assert.throws(() => paginator.page({ cursor: first.nextCursor }), /duplicate/);
    assert.deepEqual(paginator.stats(), before);
    value = 'short';
    assert.throws(() => paginator.page({ cursor: first.nextCursor }), /at least 16/);
    assert.deepEqual(paginator.stats(), before);
    value = token('B');
    const second = paginator.page({ cursor: first.nextCursor });
    assert.deepEqual(second.items, [2]);
    assert.deepEqual(paginator.page({ cursor: first.nextCursor }), second);
    assert.deepEqual(paginator.page({ cursor: second.nextCursor }), { items: [3] });
  });

  for (const action of ['expire', 'evict', 'clear']) {
    test(`${format}: ${action} invalidates every cursor of the removed snapshot`, () => {
      let now = 0;
      const paginator = api.createListPaginator({ pageSize: 1, maxSnapshots: 1, ttlMs: 5, now: () => now, ...deterministicOptions() });
      const first = paginator.page({ items: [1, 2, 3] });
      const second = paginator.page({ cursor: first.nextCursor });
      if (action === 'expire') now = 5;
      if (action === 'clear') assert.equal(paginator.clear(), 1);
      if (action === 'evict') paginator.page({ items: [4, 5] });
      for (const cursor of [first.nextCursor, second.nextCursor]) {
        assert.throws(() => paginator.page({ cursor }), api.PaginationCursorError);
      }
      assert.equal(paginator.stats().cursors, action === 'evict' ? 1 : 0);
      assert.equal(paginator.stats().snapshots, action === 'evict' ? 1 : 0);
    });
  }
}
