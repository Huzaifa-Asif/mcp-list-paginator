# Contributing

Thanks for helping improve `mcp-list-paginator`.

1. Open an issue for behavior changes so the scope and protocol implications are clear.
2. Fork the repository and create a focused branch.
3. Add tests for success, boundary, expiry, eviction, replay, and failure behavior as relevant.
4. Run `npm ci --ignore-scripts` and `npm run check` on Node.js 18 or newer.
5. Update the README and changelog for user-visible changes.

Pull requests must retain matching ESM, CommonJS, and TypeScript APIs. Never include credentials, private catalogs, client cursors, or production payloads in issues or tests. By contributing, you agree that your contribution is licensed under the MIT License.
