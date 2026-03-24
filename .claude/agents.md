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
