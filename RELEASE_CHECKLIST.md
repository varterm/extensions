# Editor Extension Release Checklist

The order matters in one place: the site's download link points at a GitHub
release asset, so the release has to exist before the site deploys or the link
404s. Everything else can move around.

## 1. Before packaging

- [ ] `npm test` in `extensions/vscode` — compiles and runs the unit tests.
- [ ] Version bumped in `extensions/vscode/package.json`.
- [ ] `extensions/vscode/CHANGELOG.md` and the top-level `CHANGELOG.md` both
      describe the release.
- [ ] `EDITOR_EXTENSION_VERSION` in the platform repo's `lib/extension-links.js`
      matches the new version.
- [ ] Anything that belongs in the **store listing** is already in
      `extensions/vscode/README.md`. Both stores read the long description from
      the README *inside the VSIX*, so edits made after packaging do not reach
      the stores, and a published version cannot be replaced. Late copy waits
      for the next version.

## 2. Package and check the artifact

```bash
cd extensions/vscode
npm run package
```

- [ ] Version inside the VSIX matches: `unzip -p *.vsix extension/package.json`.
- [ ] Compiled output is in `extension/dist/`, not `out/`.
- [ ] No `tests/`, no `.env*`, no raw `.ts` beyond the bundled client's `.d.ts`.
- [ ] `assets/varterm-icons.ttf` shows as modified with the same byte count and
      no content change — that is timestamp churn from the icon build. Revert it
      to keep the diff clean.

## 3. Commit and tag

The shell wrapper appends an AI co-author trailer to `git commit` even with no
hook or git config set. Build the commit with plumbing instead, which bypasses
it:

```bash
git add <files>
tree=$(git write-tree)
new=$(git commit-tree "$tree" -p "$(git rev-parse HEAD)" -F /path/to/message)
git reset --hard "$new"
git log -1 --format='%B' | rg -i cursor   # expect no output
```

- [ ] Tag `vX.Y.Z` and push the branch, then the tag.

## 4. The release publishes itself

`.github/workflows/release.yml` fires on any `v*` tag: it packages both
extensions, takes the notes from the matching `CHANGELOG.md` section, and
creates the GitHub release. Two consequences:

- [ ] **The notes are only as good as the changelog.** The section is matched on
      the tag with the `v` stripped, so `## X.Y.Z` has to exist or the release
      goes out with a bare "Built from tag" line and a warning in the job log.
      Check the rendered notes afterwards.
- [ ] **The published VSIX is CI's build, not yours.** It differs from a local
      build by zip timestamps. Confirm the file list and per-file sizes match
      rather than comparing checksums, which will never agree.

## 5. Publish to the stores

```bash
npm run stores:status      # what each store is serving now
npm run publish:dry-run    # verifies credentials, publishes nothing
npm run publish:stores
```

- [ ] Open VSX holds a new version **inactive** while it scans, roughly four
      minutes. During that window the API returns 404 for the version and
      re-running the publish reports "already published, but currently isn't
      active". Both are expected; wait rather than retrying.
- [ ] The Marketplace search index lags its own API, so the public listing can
      show the previous version for a few minutes after a successful publish.
- [ ] `VSCE_PAT` in `~/.varterm-publish.env` ships as a `replace-with-...`
      placeholder. The script treats a placeholder as absent and falls back to a
      `vsce login` keychain credential if one exists.

## 6. Deploy the site

- [ ] Push the platform repo. Vercel deploys on push to `main`.
- [ ] The commit that bumps `extension-links.js` also changes the download URL,
      so the GitHub release must already exist.

## 7. Verify what users see

```bash
# the download the site points at
curl -sI -L -o /dev/null -w "%{http_code}\n" \
  https://github.com/varterm/extensions/releases/download/vX.Y.Z/varterm-cursor-X.Y.Z.vsix

# each registry
curl -s https://open-vsx.org/api/Varterm/varterm-cursor | jq -r .version
npm run stores:status
```

- [ ] Exercise the actual fix against production, not just the deploy. For
      0.1.64 that meant confirming `/api/edge-tts` answers 422 with a reason for
      text it cannot voice, and still returns audio for a matched voice.
