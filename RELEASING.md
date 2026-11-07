# Releasing

1. Bump the version in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`. Run `cargo check` in `src-tauri` so `Cargo.lock` picks it up, then commit.
2. Tag and push:

   ```sh
   git tag v0.2.0
   git push origin main v0.2.0
   ```

The [Release workflow](.github/workflows/release.yml) builds a universal `Keylight.app`. It publishes the release with `Keylight-<version>-universal.zip`, the updater bundle and `latest.json`. Running copies of Keylight find it within a day, or straight away from Device → Updates. The workflow fails if the tag doesn't match the version in `tauri.conf.json`.

Afterwards, edit the release notes on GitHub. Then update the Homebrew cask in `AmoabaKelvin/homebrew-tap`; the workflow's run summary has the zip's sha256.

To try the workflow without releasing anything, run it from the Actions tab. It builds into a draft release named after the run. Delete the draft afterwards.

The updater signing key is in `~/.tauri/keylight-updater.key` and the `TAURI_SIGNING_PRIVATE_KEY` repo secret. If it's lost, installed copies can't update any more; people would have to download the next version by hand.
