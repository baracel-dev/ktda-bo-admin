# Reverting the Nawiri rebrand (back to KTDA)

The staff console was rebranded from KTDA to Nawiri in November 2026 (PR #41). Only visible names, the logo and
favicons changed; no API call, route, storage key or identifier changed. The apps and backend have their own revert
guide: `docs/NAWIRI-REVERT.md` in baracel-dev/ktda-omnichannel-stub. That guide also covers the saved payout labels and
APK rebuilds.

| | Commit |
|---|---|
| Last KTDA commit (tag `ktda-before-nawiri`) | `01a7cfe37f93f876cefbc6e9399ac9c723f429ff` |
| Rebrand | `76cb01968f3ce6a25222e3248e02d78300283436` (30 files) |
| This note | the commit after it; tag `nawiri-rebrand-v1` marks the end of the branch |
| Commit on main after merging #41 | `3cb142ba03e9878d6babcee379632a86c455d926` (Create a merge commit, 2026-11-23) |

`git diff ktda-before-nawiri nawiri-rebrand-v1` shows the whole change.

## Revert

On a new branch from an up-to-date main, opened as a PR (never pushed straight to main):

```sh
git checkout main && git pull && git checkout -b revert/nawiri-rebrand
git revert -m 1 3cb142ba03e9878d6babcee379632a86c455d926   # this repo (merged with "Create a merge commit")
# Other merge methods, for reference:
git revert -m 1 <merge-commit>                    # merged with "Create a merge commit"
git revert <squash-commit>                        # merged with "Squash and merge"
git revert <first-rebased>^..<last-rebased>       # merged with "Rebase and merge"
git grep -n -i nawiri -- src e2e public index.html  # expect no results
npm run build && npx playwright test
```

Expect one conflict on `docs/NAWIRI-REVERT.md` itself, because the merge commit ID was added to it after the merge. Keep the guide with `git add docs/NAWIRI-REVERT.md && git revert --continue`; then the code matches `ktda-before-nawiri` exactly, and only this guide differs (checked on 2026-11-23 with a rehearsal revert).

`git revert` keeps any work merged after the rebrand. On a conflict, keep the later work and only restore the KTDA
wording. Then redeploy with the "Deploy to EC2" workflow (started by hand) if the Nawiri console was deployed.
