# Open Source Release Checklist

Audit date: 2026-03-06

This checklist is based on the current repository state and is focused on making the repository safe and usable for a public open source release.

## Release blockers

- [ ] Add a top-level `LICENSE` file.
  Reason: the repository currently has no root license file, so outside users do not have clear legal permission to use, modify, or distribute the code.

- [ ] Audit `config/credentials.yml.enc` and rotate any secrets that may have ever been stored in it before making the repository public.
  Reason: encrypted credentials are expected in Rails, but once the repository is public you should assume the encrypted blob is permanent and review whether any production or personal secrets need rotation.

- [ ] Decide whether `config/deploy.yml` should ship as a real deployment file or as a template/example.
  Current state: it still contains placeholder infrastructure values like `192.168.0.1`, `localhost:5555`, and commented production notes.

- [ ] Document clearly that Forge is a local-first, single-user tool unless you add authentication.
  Reason: the web UI and JSON API expose write-capable actions with no auth layer, and those actions can trigger `git`, `gh`, local worktree creation, and AI CLI execution.

## Strongly recommended before public release

- [ ] Add `CONTRIBUTING.md`.
  Include:
  - local setup
  - test commands
  - coding standards
  - PR expectations
  - how to report bugs

- [ ] Add `SECURITY.md`.
  Include:
  - supported versions
  - where to report vulnerabilities privately
  - expected response policy
  - explicit guidance not to file public issues for secrets or auth problems

- [ ] Add `CODE_OF_CONDUCT.md`.
  This is standard OSS hygiene and reduces ambiguity for external contributors.

- [ ] Add a public configuration guide or `.env.example`.
  Include the required runtime inputs:
  - Ruby version
  - Node/npm version
  - `gh` authentication
  - supported AI CLIs (`claude`, `codex`, `opencode`)
  - `FORGE_API_URL`
  - `RAILS_MASTER_KEY` for production

- [ ] Expand `README.md` for external users.
  Missing or under-documented items:
  - supported OSes
  - whether the app is intended for localhost only
  - production deployment posture
  - first-run configuration for `repos_folder`
  - how reviews are executed and what local tools are invoked
  - screenshots or a short demo

- [ ] Align package metadata with the actual project license decision.
  Current state: `package.json` says `"license": "ISC"` while the repository has no top-level license file yet.

- [ ] Add GitHub community health files or templates.
  Recommended:
  - issue templates
  - pull request template
  - funding/support guidance if applicable

## Internet-facing deployment risks

These are not blockers for publishing the code, but they are blockers for exposing the running app to the public internet.

- [ ] Add authentication and authorization before any public deployment.
  Current state: routes under `/`, `/settings`, `/repositories`, `/review_tasks`, and `/api/v1/*` are unauthenticated.

- [ ] Enable TLS and host protection in production.
  Current state: `config.force_ssl`, `config.assume_ssl`, and explicit production hosts are still commented out in `config/environments/production.rb`.

- [ ] Define and enforce a Content Security Policy.
  Current state: `config/initializers/content_security_policy.rb` is fully commented out.

- [ ] Review path and command execution surfaces.
  Reason: the app stores local repository paths, shells out to `git` and `gh`, and launches external AI CLIs against local worktrees. That is acceptable for trusted local use, but not for anonymous or multi-tenant access.

- [ ] Decide whether macOS-only behavior is acceptable.
  Current state: folder picking uses `osascript`, so the UI setup path is macOS-specific unless there is a documented fallback.

## Current strengths

- [x] CI workflow exists in `.github/workflows/ci.yml`.
- [x] Dependency update automation exists in `.github/dependabot.yml`.
- [x] Security scanning is wired in for Rails and dependency audits.
- [x] Sensitive local files are mostly ignored in `.gitignore` (`.env*`, `config/*.key`, storage, logs, temp files).
- [x] The project includes a substantial automated test suite under `test/`.

## Validation notes from this audit

- `bin/ci` could not be fully executed from the default shell environment because the machine defaulted to system Ruby 2.6 instead of the app's declared Ruby 3.4.2.
- `asdf` is present and matches `.ruby-version`, but the Ruby 3.4.2 gem set is not installed in this environment, so I could not confirm test or lint pass/fail from execution alone.
- `.kamal/secrets` is tracked in git, but its current contents are comments plus indirection to `config/master.key`, not raw secrets. Keep it that way if the repo becomes public.

## Suggested release order

- [ ] Finish the release blockers.
- [ ] Add the recommended OSS metadata files.
- [ ] Do a final secret-history review before publishing.
- [ ] Run `bin/ci` in a clean Ruby 3.4.2 environment.
- [ ] Publish the repository.
- [ ] Only after that, evaluate whether you want a hardened public deployment story.
