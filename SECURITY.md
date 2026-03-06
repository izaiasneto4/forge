# Security Policy

## Scope

Forge is currently designed as a local-first tool operated by a trusted user on their own machine or private network.

It is not hardened for anonymous or multi-tenant internet exposure by default. In particular, the current app and JSON API perform privileged local actions such as:

- reading configured local repository paths
- invoking `git` and `gh`
- creating worktrees
- launching AI CLIs against local code

Do not expose the app directly to the public internet without adding authentication, transport security, and deployment hardening.

## Reporting a vulnerability

Please do not open a public GitHub issue for security vulnerabilities.

Instead, report issues privately to the project maintainer through a private channel before public disclosure. Include:

- affected version or commit
- reproduction steps
- impact
- any suggested mitigation

## Response goals

- Initial acknowledgement: within 7 days
- Triage and severity assessment: as soon as practical
- Fix timeline: depends on severity and maintainer availability

## Supported versions

Security support is currently best-effort and focused on the latest `main` branch until a formal release policy exists.

## Secrets guidance

- Assume anything committed to git is durable and may become public.
- Never commit `config/master.key`, `.env` files, API tokens, SSH keys, or private certificates.
- Audit and rotate credentials before publishing the repository if they may have been stored in `config/credentials.yml.enc`.
