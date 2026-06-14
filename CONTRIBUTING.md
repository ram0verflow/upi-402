# Contributing to upi-402

## Running tests

```bash
npm install
npm test
```

All tests use mock mode. No credentials needed.

## Adding a verifier

Implement the `VerifyFunction` interface from `src/types.ts`:

```typescript
type VerifyFunction = (
  mandateRef: string,
  amount: number,
  txnRef: string,
) => Promise<{ success: boolean; pending?: boolean; txnId?: string; error?: string }>;
```

See `src/verifiers/mock.ts` for a reference implementation. Place your verifier in `src/verifiers/` and add it to `tsup.config.ts` entries and `package.json` exports.

Only PAs that support instant, on-demand charge execution (no mandatory scheduling) are compatible with this protocol. See [PA_RESEARCH.md](./PA_RESEARCH.md) for details.

## PR expectations

- All existing tests pass (`npm test`)
- New code has tests
- Conventional commit messages (`feat:`, `fix:`, `test:`, `docs:`, `refactor:`, `chore:`)
- One logical change per commit
