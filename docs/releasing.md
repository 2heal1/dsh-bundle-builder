# Releasing

1. Run `pnpm changeset` for a publishable change and commit the generated file.
2. To publish a preview, push the branch and run the **Release** workflow on that branch.
3. Merge the normal pull request to create or update the release pull request.
4. Review and merge the release pull request to publish the stable version.

Changesets manages versions and the release pull request. Stable and preview artifacts are published by npm CLI with trusted publishing from `.github/workflows/release.yml`; the repository does not store an npm token.
