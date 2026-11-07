# Releasing

1. Bump the version in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`. Run `cargo check` in `src-tauri` so `Cargo.lock` picks it up, then commit.
2. Tag and push:

   ```sh
   git tag v0.2.0
   git push origin main v0.2.0
   ```

The [Release workflow](.github/workflows/release.yml) builds a universal `Keylight.app`. It publishes the release with `Keylight-<version>-universal.zip`, the updater bundle and `latest.json`. Running copies of Keylight find it within a day, or straight away from Device → Updates. The workflow fails if the tag doesn't match the version in `tauri.conf.json`.

Afterwards, edit the release notes on GitHub. Then update the Homebrew cask in `AmoabaKelvin/homebrew-tap`; the workflow's run summary has the zip's sha256.

## Without GitHub Actions

`scripts/release.sh` does the same on this Mac. It needs both Rust targets (`rustup target add aarch64-apple-darwin x86_64-apple-darwin`).

On its own it's a dry run. It builds, signs and writes the zip, the updater files, `latest.json` and the notes to `src-tauri/target/release-files/v<version>/`. Check them, then run `scripts/release.sh --publish --skip-build` to create the release and its tag from that build. Push the commit first and skip step 2. The script won't publish from a dirty tree or from a build that isn't universal.

## Testing the workflow

Run it from the Actions tab. It builds into a draft release named after the run, which no app updates from. Delete the draft afterwards.

## The signing key

The updater key is in `~/.tauri/keylight-updater.key` and in the `TAURI_SIGNING_PRIVATE_KEY` repo secret. If it's lost, installed copies can't update any more, and people would have to download the next version by hand.
