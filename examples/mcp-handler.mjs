import { createListPaginator } from '../src/index.js';

const paginator = createListPaginator({ pageSize: 2 });
const catalog = [{ name: 'search' }, { name: 'fetch' }, { name: 'summarize' }];

function listTools(request) {
  const params = request.params ?? {};
  const page = Object.hasOwn(params, 'cursor')
    ? paginator.page({ cursor: params.cursor })
    : paginator.page({ items: catalog });
  return { tools: page.items, ...(page.nextCursor && { nextCursor: page.nextCursor }) };
}

const first = listTools({ params: {} });
const second = listTools({ params: { cursor: first.nextCursor } });
console.log(JSON.stringify({ first, second }, null, 2));
