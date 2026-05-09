# Test Evidence

## Date

- 2026-05-04

## Backend (`/Users/jc_io/src/varterm`)

- `npm test`
  - Result: pass
  - Summary: 9 tests passed, 0 failed
- `npm run build`
  - Result: pass
  - Confirmed routes include:
    - `/api/ingest`
    - `/api/ask`

## Extension (`/Users/jc_io/src/varterm-vscode`)

- `npm run check`
  - Result: pass
- `npm run build`
  - Result: pass
- `npm run package`
  - Result: pass
  - Artifact: `varterm-vscode-0.1.0.vsix`

## Local API Smoke (dev server on port 4010)

- Ingest request:
  - `POST /api/ingest`
  - Result: `200`
  - Returned `sessionId`
- Ask request with returned session:
  - `POST /api/ask`
  - Result: `200`
  - Returned answer + sources
- Missing session request:
  - `POST /api/ask` with invalid `sessionId`
  - Result: `404`
  - Returned expected session-missing error

## Notes

- Retrieval-only fallback answer is expected when `ANTHROPIC_API_KEY` is not set.
- Manual in-editor smoke steps remain in `RELEASE_CHECKLIST.md`.
