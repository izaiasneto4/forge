# Ordem Rename Design

## Goal

Rename the application identity from Forge to Ordem throughout the repository so the interface, documentation, developer commands, and app-owned runtime identifiers consistently use the new name.

## Scope

- Change visible app branding and metadata, including the Rails UI payload, frontend title and header, README, security notes, issue templates, license attribution, roadmap, and project guidance.
- Rename the local CLI from `bin/forge` to `bin/ordem`; update its usage text, library files and Ruby namespace from `Forge` to `Ordem`, related test paths/names, scripts, and CI references.
- Rename `FORGE_API_URL` to `ORDEM_API_URL` with no old-variable fallback. Update examples and CLI integration coverage accordingly.
- Rename app-owned worktree directory, branch prefix, summary temp files, triage session identifiers, sync thread key, and other generated identifiers that include the old app name.
- Update package metadata, Docker examples, and Kamal service/image labels. Preserve the existing `forge_storage` volume identifier so deployments continue to use the same persistent data.
- Regenerate the checked-in frontend build output from the updated source.
- Update the source-level application referer metadata to the expected `https://github.com/izaiasneto4/ordem` URL. The local Git remote and GitHub repository rename are outside this code change.

## Compatibility and data

This is a complete in-repository rename. Existing scripts that call `bin/forge`, Ruby consumers that reference `Forge::*`, and environments that set `FORGE_API_URL` must move to the Ordem names. No compatibility wrappers or deprecated aliases will be retained.

The new worktree directory and branch prefix apply to newly created review worktrees. Existing per-repository `.forge-worktrees` directories and historical branches are not migrated or deleted by this change. The persistent Kamal volume remains named `forge_storage` to retain the current data identity.

Generic English uses such as “request forgery” are unrelated and remain unchanged. Git history, `.git` metadata, and the current workspace directory are outside the rename.

## Implementation and verification

Update source, documentation, configuration, and tests together, preserving unrelated existing working-tree changes. Rename files and directories where their paths carry the old app name. Build the frontend so checked-in assets match the new source. Verify that app-owned references no longer use the old identity, while the documented storage and repository metadata exceptions remain. Do not run the test suites as part of this task.

## Acceptance criteria

1. App-facing names and repository-maintained setup/docs identify the app as Ordem.
2. The Ordem CLI, Ruby namespace, and `ORDEM_API_URL` are the active interfaces.
3. Test and CI references point to the renamed files and commands.
4. The frontend build output reflects the updated title and branding.
5. Existing unrelated edits remain intact, and the persistent volume name remains stable.
