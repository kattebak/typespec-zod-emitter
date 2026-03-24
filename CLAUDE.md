# TypeSpec Zod Emitter

A TypeSpec compiler emitter that generates Zod validation schemas from TypeSpec model definitions. Produces complete, publishable npm packages with TypeScript support.

## Commands

- `npm test` — full pipeline: build, lint, unit tests, emit test, smoke tests
- `npm run build` — compile TypeScript (`tsc`)
- `npm run lint` — lint with Biome (`npx @biomejs/biome check`)
- `npm run fix` — auto-fix lint issues (`npx @biomejs/biome check --write`)
- `npm run test:unit` — unit tests only (`node --test --import=tsx src/**/*.test.ts`)
- `npm run test:emit` — compile test TypeSpec definitions (`tsp compile test/main.tsp --config test/tspconfig.yaml`)
- `npm run test:example` — smoke tests against emitted output (`node --test test/example.js`)

## Architecture

- `src/emitter.ts` — core emitter: type collection, topological sort, Zod code generation, package scaffolding
- `src/lib.ts` — TypeSpec library definition and emitter options schema
- `src/index.ts` — entry point, re-exports `$onEmit` and `$lib`
- `test/main.tsp` — TypeSpec fixtures for smoke tests
- `test/example.js` — smoke tests that validate emitted schemas at runtime
- Emitted output lands in `build/zod-schemas/` during tests

## Testing

- Unit tests (`src/emitter.test.ts`): test internal helpers via `__test` export — identifiers, enums, scalars, unions, topological sort, anonymous objects, templates
- Smoke tests (`test/example.js`): compile `test/main.tsp`, then import and validate the emitted Zod schemas
- Node built-in test runner (`node:test`), assertions via `node:assert/strict`
- No mocking frameworks; unit tests use lightweight type stubs

## Conventions

- ES modules (`"type": "module"`)
- Biome for formatting and linting
- Commit messages follow Conventional Commits (`fix:`, `feat:`, `fix!:` for breaking)
- semantic-release on main for versioning and npm publish
- Internal helpers exported via `__test` for unit testing
