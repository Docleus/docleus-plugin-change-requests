<p align="center">
  <a href="https://docleus.io"><img src="./.github/assets/docleus.svg" width="88" alt="Docleus logo" /></a>
</p>

<h1 align="center">Change Requests</h1>

<p align="center">
  <strong>Draft. Review. Merge. Publish.</strong><br />
  Branch-based writing, approvals, and block-level conflict resolution.
</p>

<p align="center">
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-111111?style=flat-square" /></a>
  <img alt="Public preview in preparation" src="https://img.shields.io/badge/preview-0.0.1-cfcfcf?style=flat-square" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square" />
  <a href="https://docleus.io"><img alt="Online documentation" src="https://img.shields.io/badge/docs-docleus.io-111111?style=flat-square" /></a>
</p>

<p align="center">
  <a href="https://docleus.io">Documentation</a> &middot;
  <a href="#install">Install</a> &middot;
  <a href="https://github.com/Docleus/docleus">Run Docleus</a> &middot;
  <a href="https://github.com/Docleus/.github/blob/main/CONTRIBUTING.md">Contribute</a>
</p>

---

Change requests for Docleus spaces. Edits go to a branch `cr/<number>` instead of `main`; a change request is reviewed, approved, updated from `main` (rebase), its conflicts resolved, and merged in one click. Branches, revisions and the three-way merge belong to `ctx.content`; this plugin keeps only change-request metadata, approvals, stored conflict resolutions and the per-space workflow setting.

## Install

Add this row to the deployment config's `plugins` list. Paths resolve relative
to that file. The default distribution already includes this plugin.

```yaml
plugins:
  - id: change-requests
    plugin: ../docleus-plugin-change-requests
```

Run `pnpm build` first: the instance loads `dist/server/index.js` and `dist/editor/index.js` from `docleus.plugin.json`. Organizations created in the browser enable installed plugins automatically; existing organizations or spaces with explicit overrides can enable it in Settings, Plugins (`PUT /api/orgs/:orgId/plugins` or `PUT /api/orgs/:orgId/spaces/:spaceId/plugins` with `{ "plugin": "@docleus/plugin-change-requests", "enabled": true }`).

The server entry needs the `storage`, `content`, `http`, `authz`, `installations` and `identity` services. It has no config.

## Workflow settings

| Field               | Values                        | Default           |
| ------------------- | ----------------------------- | ----------------- |
| `mode`              | `change-requests` or `direct` | `change-requests` |
| `requiredApprovals` | `0` to `20`                   | `0`               |

Settings are set per org and per space; a space without its own settings uses the org's, then the default. In `change-requests` mode, user commits to `main` are rejected and editing starts a change request. In `direct` mode, users edit `main` as without the plugin. Settings are stored with `ctx.installations.setSettings` and validated when read; invalid settings fall back to the default with a warning.

With `requiredApprovals: 0`, the author (or anyone with `write`) can merge a draft or open change request. With `requiredApprovals: N > 0`, the change request must be open and approved by at least `N` users other than the author. An approval is for the branch head it was given at: a new commit to the branch (an edit or a rebase) drops it, so reviewers approve again.

In both modes, required checks that plugins report through `change-request/checks` must succeed before a merge (see [Events](#events)).

## HTTP API

`CR` is `/api/orgs/:orgId/spaces/:spaceId/change-requests`. Every route checks `read` (GET) or `write` (other methods) on the space (403 `change-requests/forbidden`), then that the space exists (404 `change-requests/space-not-found`), then that the plugin is enabled for it (404 `change-requests/not-enabled`). Errors answer `{ code, message }`.

| Route                                                                 | Does                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET CR?status=active\|draft\|open\|merged\|closed\|all`              | `{ changeRequests }`, newest first; default `active` (draft and open). Drafts are listed only for their author and space admins.                                                                                                                                                                                                                                                                                                               |
| `POST CR` `{ title? }`                                                | Creates a draft (default title `Untitled change request`) and its branch `cr/<number>` from the head of `main`. 201 `{ changeRequest }`.                                                                                                                                                                                                                                                                                                       |
| `GET CR/:number`                                                      | `{ changeRequest, state }`, where `state` says for the caller whether the change request is behind `main`, how many conflicts are unresolved, and whether they can merge, approve and edit, and lists the `checks` plugins reported for the branch head. Someone else's draft is 404 `change-requests/not-found`, except for space admins.                                                                                                     |
| `PATCH CR/:number` `{ title?, description? }`                         | Author or space admin. `{ changeRequest }`.                                                                                                                                                                                                                                                                                                                                                                                                    |
| `POST CR/:number/request-review`                                      | Draft to open. Author or space admin.                                                                                                                                                                                                                                                                                                                                                                                                          |
| `POST CR/:number/approve`, `DELETE CR/:number/approve`                | Adds or withdraws the caller's approval. Open change requests only (409 `change-requests/invalid-state`), never by the author (403 `change-requests/not-allowed`).                                                                                                                                                                                                                                                                             |
| `POST CR/:number/close`                                               | Draft or open to closed; deletes the branch. Author or space admin.                                                                                                                                                                                                                                                                                                                                                                            |
| `GET CR/:number/changes`                                              | `{ changes }`: entries added, removed, changed or moved from the branch base to its head (for merged and closed change requests, as they were then).                                                                                                                                                                                                                                                                                           |
| `GET CR/:number/conflicts`                                            | `{ main, conflicts, resolutions }`: the conflicts of merging the branch into the current `main` with the stored resolutions.                                                                                                                                                                                                                                                                                                                   |
| `PUT CR/:number/resolutions` `{ resolutions }`                        | Replaces the stored resolutions (keyed by conflict id; `{ take: "ours" \| "theirs" }` or `{ value }`). Returns what `GET conflicts` returns.                                                                                                                                                                                                                                                                                                   |
| `POST CR/:number/rebase`                                              | Updates the branch from `main`: a no-op when `main` has not moved since the branch base; otherwise commits the merged entries to the branch with `rebase: <main head>` and clears the resolutions. Unresolved conflicts answer 409 `change-requests/merge-conflict` with `conflicts`. `{ changeRequest, head }`.                                                                                                                               |
| `POST CR/:number/merge`                                               | Merges into `main` when the workflow allows it (else 403 `change-requests/not-allowed`): commits the merged entries to `main` with `merged: <branch head>`, the caller as author and the message `Merge change request #<n>: <title>`, marks the change request merged and deletes the branch. Conflicts answer 409 as for rebase; required checks that did not succeed answer 409 `change-requests/checks-failed`. `{ changeRequest, head }`. |
| `GET`, `PUT /api/orgs/:orgId/spaces/:spaceId/change-request-workflow` | `{ workflow, inherited }`: the effective settings and whether they come from the org or the default. `PUT { workflow }` (or `{ workflow: null }` to clear the space's own settings) needs `manage` on the space.                                                                                                                                                                                                                               |
| `GET`, `PUT /api/orgs/:orgId/change-request-workflow`                 | The same for the org (`read` / `manage` on the org). Answers 404 `change-requests/not-enabled` while the plugin is not installed.                                                                                                                                                                                                                                                                                                              |

Writes to the change requests of a space run one at a time, so a double-clicked merge commits once (the second click answers 403 because the change request is already merged).

## Events

- Listens to `content/pre-commit` (waterfall), which core runs only in spaces where the plugin is enabled. Commits to branches other than `main`, commits without an author (system commits) and merge commits pass. Other commits to `main` are rejected with `change-requests/commit-rejected` (409 in the instance API) when the space's mode is `change-requests`.
- Dispatches `change-request/checks` (parallel, filtered by the space) when it shows or merges an open or draft change request. Listeners call `input.report(check)` with `{ name, title, status: "pending" | "success" | "failure", isRequired, summary?, url? }` for the branch head in `input.head`; `name` is namespaced (`acme.lint`). A merge needs every required check to succeed, and is checked again after `content/flush` moves the head. A listener that throws, an invalid or duplicate report, or more than 100 reports turn into one failed required check `change-requests.check-error`.
- Appends `change-request/merged` `{ spaceId, number, revision, branch }` to the content log after each merge (`revision` is the merge revision on `main`).

## Editor

The editor entry starts a change request on the first edit of `main` (through `ctx.ui.registerEditBranch`), resumes the user's open draft on Edit (`registerEditDraft`), puts the draft's state and its Review and Merge actions in the space top bar (slot `space.bar`), shows the review panel with a block diff (slot `space.panel`), lists active change requests in the space sidebar, shows the list, a change request and its conflict resolution inside the space (slot `space.view`, `?view=change-requests.requests[&cr=<n>[&conflicts=1]]`, so the page tree stays in the sidebar), and adds the workflow settings page. The `/apps/change-requests/...` app remains only to redirect older links there.

## Tests

- `pnpm test`: unit tests next to the code, and integration tests (`tests/change-requests.test.ts`) against a real instance from `@docleus/server` with this plugin mounted, an org owner, two space editors and a space viewer.
- `pnpm e2e`: Playwright tests in `tests/e2e/`. The bundle adds `tests/e2e/fixtures/release-check`, a plain JavaScript plugin that reports a required check.

## Development

Use Node.js 24 and pnpm 11.21.0. Keep this repository next to `docleus-core`
with its original directory name; the `link:` development dependencies need
that layout. Install core before this repository:

```sh
pnpm --dir ../docleus-core install --frozen-lockfile
pnpm install --frozen-lockfile
pnpm check
pnpm build
```

`pnpm check` runs typecheck, lint, formatting, dependency boundaries, licenses,
and unit/in-process integration tests. Browser and external-service tests,
where provided, are separate and need the sibling repositories listed in
their setup files. The SDK is a host-provided peer dependency; packages remain
private and are not installed from npm. All extension points are experimental
before 1.0.

## Community

[Contributing](https://github.com/Docleus/.github/blob/main/CONTRIBUTING.md) &middot;
[Code of conduct](https://github.com/Docleus/.github/blob/main/CODE_OF_CONDUCT.md) &middot;
[Security](https://github.com/Docleus/.github/blob/main/SECURITY.md) &middot;
[Support](https://github.com/Docleus/.github/blob/main/SUPPORT.md)

## License

[MIT](LICENSE)
