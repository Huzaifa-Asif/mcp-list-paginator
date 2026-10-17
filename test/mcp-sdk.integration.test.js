import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ErrorCode,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { PaginationCursorError, createListPaginator } from '../src/index.js';

const catalogByScope = new Map([
  ['scope-a', {
    tools: ['a-tool-1', 'a-tool-2', 'a-tool-3'].map((name) => ({ name, inputSchema: { type: 'object' } })),
    resources: ['a-resource-1', 'a-resource-2', 'a-resource-3'].map((name) => ({ name, uri: `test:///${name}` })),
    templates: ['a-template-1', 'a-template-2', 'a-template-3'].map((name) => ({ name, uriTemplate: `test:///${name}/{id}` })),
    prompts: ['a-prompt-1', 'a-prompt-2', 'a-prompt-3'].map((name) => ({ name })),
  }],
  ['scope-b', {
    tools: ['b-tool-1', 'b-tool-2'].map((name) => ({ name, inputSchema: { type: 'object' } })),
    resources: [],
    templates: [],
    prompts: [],
  }],
]);

function createScopedHandlers() {
  const scopes = new Map();

  function paginatorFor(scope, operation) {
    let operations = scopes.get(scope);
    if (!operations) {
      operations = new Map();
      scopes.set(scope, operations);
    }
    let paginator = operations.get(operation);
    if (!paginator) {
      paginator = createListPaginator({ pageSize: 1 });
      operations.set(operation, paginator);
    }
    return paginator;
  }

  function handler(operation, resultKey) {
    return (request, extra) => {
      const scope = extra.authInfo?.clientId ?? 'anonymous';
      const params = request.params ?? {};
      const paginator = paginatorFor(scope, operation);
      try {
        const page = Object.hasOwn(params, 'cursor')
          ? paginator.page({ cursor: params.cursor })
          : paginator.page({ items: catalogByScope.get(scope)?.[operation] ?? [] });
        return {
          [resultKey]: page.items,
          ...(page.nextCursor && { nextCursor: page.nextCursor }),
        };
      } catch (error) {
        if (error instanceof PaginationCursorError || error instanceof TypeError) {
          throw new McpError(ErrorCode.InvalidParams, 'Invalid pagination cursor');
        }
        throw error;
      }
    };
  }

  return {
    register(server) {
      server.setRequestHandler(ListToolsRequestSchema, handler('tools', 'tools'));
      server.setRequestHandler(ListResourcesRequestSchema, handler('resources', 'resources'));
      server.setRequestHandler(ListResourceTemplatesRequestSchema, handler('templates', 'resourceTemplates'));
      server.setRequestHandler(ListPromptsRequestSchema, handler('prompts', 'prompts'));
    },
    revoke(scope) {
      const operations = scopes.get(scope);
      if (!operations) return 0;
      let removed = 0;
      for (const paginator of operations.values()) removed += paginator.clear();
      scopes.delete(scope);
      return removed;
    },
  };
}

async function connect(scope, handlers) {
  const server = new Server(
    { name: `test-server-${scope}`, version: '1.0.0' },
    { capabilities: { tools: {}, resources: {}, prompts: {} } },
  );
  handlers.register(server);

  const client = new Client(
    { name: `test-client-${scope}`, version: '1.0.0' },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const send = clientTransport.send.bind(clientTransport);
  clientTransport.send = (message, options = {}) => send(message, {
    ...options,
    authInfo: { token: `test-token-${scope}`, clientId: scope, scopes: [] },
  });

  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client,
    async close() {
      await client.close();
      await server.close();
    },
  };
}

async function collect(call, resultKey) {
  const items = [];
  let page = await call();
  items.push(...page[resultKey]);
  while (page.nextCursor) {
    page = await call({ cursor: page.nextCursor });
    items.push(...page[resultKey]);
  }
  return items;
}

test('real SDK clients traverse all four standard list methods', async (t) => {
  const handlers = createScopedHandlers();
  const connection = await connect('scope-a', handlers);
  t.after(() => connection.close());

  const { client } = connection;
  const cases = [
    [(params) => client.listTools(params), 'tools', 'tools'],
    [(params) => client.listResources(params), 'resources', 'resources'],
    [(params) => client.listResourceTemplates(params), 'resourceTemplates', 'templates'],
    [(params) => client.listPrompts(params), 'prompts', 'prompts'],
  ];

  for (const [call, resultKey, catalogKey] of cases) {
    const items = await collect(call, resultKey);
    assert.deepEqual(items, catalogByScope.get('scope-a')[catalogKey]);
  }
});

test('supplied empty cursors map to InvalidParams instead of starting over', async (t) => {
  const handlers = createScopedHandlers();
  const connection = await connect('scope-a', handlers);
  t.after(() => connection.close());

  await assert.rejects(connection.client.listTools({ cursor: '' }), (error) => {
    assert.ok(error instanceof McpError);
    assert.equal(error.code, ErrorCode.InvalidParams);
    return true;
  });
});

test('cursors are isolated by authorization scope and cleared on revocation', async (t) => {
  const handlers = createScopedHandlers();
  const scopeA = await connect('scope-a', handlers);
  const scopeB = await connect('scope-b', handlers);
  t.after(async () => {
    await scopeA.close();
    await scopeB.close();
  });

  const first = await scopeA.client.listTools();
  assert.deepEqual(first.tools.map(({ name }) => name), ['a-tool-1']);
  assert.ok(first.nextCursor);

  await assert.rejects(scopeB.client.listTools({ cursor: first.nextCursor }), (error) => {
    assert.equal(error.code, ErrorCode.InvalidParams);
    return true;
  });

  assert.equal(handlers.revoke('scope-a'), 1);
  await assert.rejects(scopeA.client.listTools({ cursor: first.nextCursor }), (error) => {
    assert.equal(error.code, ErrorCode.InvalidParams);
    return true;
  });
});
