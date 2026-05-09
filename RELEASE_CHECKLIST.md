# Internal Release Checklist

## Build Artifacts

- [x] Extension compiles (`npm run check`, `npm run build`).
- [x] VSIX packaged (`npm run package`).
- [x] Artifact path confirmed: `varterm-vscode-0.1.0.vsix`.

## Backend Readiness (`varterm`)

- [x] `POST /api/ingest` implemented and tested.
- [x] `POST /api/ask` implemented and tested.
- [x] Optional auth token guard (`VARTERM_EXTENSION_API_TOKEN`) implemented.
- [x] Session persistence verified between ingest and ask calls.

## Automated Verification

- [x] `varterm`: `npm test` (9 passing).
- [x] `varterm`: `npm run build` passes.
- [x] `varterm-vscode`: `npm run check` passes.
- [x] `varterm-vscode`: `npm run package` passes.

## Manual Smoke Steps (run in Cursor)

- [ ] Install VSIX: `Extensions: Install from VSIX...`
- [ ] Run `Varterm: Connect` and set base URL/token.
- [ ] Run `Varterm: Ingest Documents` with mixed file sizes.
- [ ] Cancel an ingest once to verify cancellation UX.
- [ ] Run `Varterm: Ask AI` and verify answer + sources.
- [ ] Open a source from picker and confirm editor reveal range.
- [ ] Run `Varterm: Clear Session` and verify ask shows missing session error.
- [ ] Test invalid token (`401`), expired/missing session (`404`), and timeout/retry behavior.

## Publish Prep (later)

- [ ] Push `varterm-vscode` repo to GitHub.
- [ ] Create Open VSX publisher metadata.
- [ ] Add CI for `check`, `test`, and VSIX packaging.
