# Changelog

## 1.0.2 - 2026-10-18

- Treat a supplied empty cursor as invalid in the runnable and README examples instead of silently starting a new snapshot.
- Document low-level TypeScript SDK integration, InvalidParams mapping, authorization-scope isolation, and revocation cleanup.
- Add real SDK integration coverage for tools, resources, resource templates, and prompts list traversal.

## 1.0.1 - 2026-10-17

- Isolate internal snapshot identities from generated cursor strings so token collisions cannot redirect an existing walk to a different list.
- Allocate the first cursor before retaining a new snapshot or evicting an existing one, preserving active walks when token generation fails.
- Add deterministic collision, allocation-failure, replay, and cleanup regressions for ESM and CommonJS.

## 1.0.0 - 2026-10-11

- Add stable shallow snapshots with opaque, replayable cursors.
- Add TTL cleanup, bounded snapshot retention, explicit clearing, and safe operational stats.
- Ship matching ESM, CommonJS, TypeScript declarations, tests, and an MCP handler example.
