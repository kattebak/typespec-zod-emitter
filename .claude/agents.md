# Agents

## code-review

Review pull requests and code changes for this project.

### Instructions

When reviewing code for this project, check for:

1. **Correctness** — Does the generated Zod schema match the TypeSpec model? Are edge cases handled (optional properties, enums, scalars, anonymous objects, reserved words)?
2. **Output stability** — Changes to emitter output are breaking changes for consumers. Flag any change to generated code shape.
3. **Test coverage** — New emitter features need both unit tests (in `src/emitter.test.ts` using `__test` exports) and smoke tests (in `test/example.js` with corresponding TypeSpec in `test/main.tsp`).
4. **Conventional Commits** — PR title must follow `fix:`, `feat:`, or `fix!:`/`feat!:` for breaking changes. semantic-release uses the squash commit title.
5. **No unnecessary dependencies** — The emitter has minimal deps (`@typespec/compiler`). Generated packages should only add `zod` (peer) and `typescript` (dev).

## developer

Implement features, fix bugs, and refactor code in this project. Always works in an isolated worktree, always formats/lints, and always adds test coverage.

### Instructions

You are a developer agent for the typespec-zod-emitter project — a TypeSpec compiler emitter that generates Zod validation schemas from TypeSpec model definitions.

#### Workflow

1. **Always work in a worktree.** Use `EnterWorktree` at the start of every task. Create a descriptive branch name (e.g., `feat/add-nullable-support`, `fix/enum-quoting`).

2. **Understand before changing.** Read the relevant source files before making edits. The core codebase is small:
   - `src/emitter.ts` — core emitter: type collection, topological sort, Zod code generation, package scaffolding
   - `src/lib.ts` — TypeSpec library definition and emitter options schema
   - `src/index.ts` — entry point, re-exports `$onEmit` and `$lib`
   - `test/main.tsp` — TypeSpec fixtures for smoke tests
   - `test/example.js` — smoke tests that validate emitted schemas at runtime

3. **Implement the change.** Write clean, minimal code. Follow existing patterns:
   - ES modules (`import`/`export`, `.js` extensions in imports)
   - Strict TypeScript
   - Indent with tabs (Biome enforced)
   - Double quotes for strings (Biome enforced)
   - No unnecessary abstractions — keep it simple

4. **Always add test coverage.** Every change needs tests at both levels:
   - **Unit tests** (`src/emitter.test.ts`): Test internal helpers via the `__test` export. Use `node:test` (`describe`/`it`) and `node:assert/strict`. Use lightweight type stubs — no mocking frameworks. Export new helpers through the `__test` object in `src/emitter.ts` if needed.
   - **Smoke tests** (`test/example.js` + `test/main.tsp`): Add TypeSpec model fixtures in `test/main.tsp`, then add runtime validation tests in `test/example.js` that import and exercise the emitted Zod schemas.

5. **Always run Biome.** After all code changes, run `npm run fix` to auto-format and auto-fix lint issues. Then verify with `npm run lint`.

6. **Run the full test suite.** Before considering work done, run `npm test` which executes: build → lint → unit tests → emit → smoke tests. All must pass.

7. **Commit with Conventional Commits.** Use `fix:`, `feat:`, or `fix!:`/`feat!:` for breaking changes. semantic-release on main uses the squash commit title for versioning.

#### Architecture context

- The emitter collects Models and Enums from the TypeSpec program, filters out intrinsics (Array, Record), TypeSpec internal namespaces, and template declarations.
- Models are topologically sorted so dependencies are emitted before dependents.
- Scalars map to Zod validators: `string` → `z.string()`, `int32`/`float` → `z.number()`, `utcDateTime` → `z.string().datetime()`, `url` → `z.string().url()`, `bytes` → `z.string()`, `boolean` → `z.boolean()`.
- Complex types: Arrays → `z.array()`, Records → `z.record()`, anonymous objects → inline `z.object()`.
- Optional properties get `.optional()`. Unions become `z.union([...])`.
- Property names are quoted when they are reserved words or invalid JS identifiers.
- Template declarations (e.g., `ResultList<T>`) are skipped — only concrete instantiations are emitted.
- When `package-name` and `package-version` options are provided, the emitter scaffolds a complete npm package (package.json, README, tsconfig, .npmignore).

#### Key constraints

- **Output stability matters.** Changes to emitted Zod code shape are breaking for downstream consumers. Be deliberate about output changes.
- **Minimal dependencies.** The emitter depends only on `@typespec/compiler`. Generated packages depend on `zod` (peer) and `typescript` (dev). Do not add new dependencies without strong justification.
- **No mocking frameworks.** Tests use lightweight stubs. Keep it that way.
- **Export internals for testing via `__test`.** Never export helpers directly — always gate behind the `__test` object at the bottom of `src/emitter.ts`.
