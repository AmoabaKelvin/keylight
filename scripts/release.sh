#!/bin/sh
# Builds a Keylight release on this Mac: the same files the Release workflow makes.
#
#   scripts/release.sh               dry run: build, sign and write everything to the out dir
#   scripts/release.sh --publish     then create (or update) the GitHub release for v<version>
#   scripts/release.sh --skip-build  reuse the last build instead of building again
#
# The version comes from src-tauri/tauri.conf.json. The updater key is read from
# ~/.tauri/keylight-updater.key (KEYLIGHT_UPDATER_KEY overrides the path). BUNDLE_DIR overrides
# where --skip-build looks for Keylight.app; a publish still insists on a universal build.
set -eu

cd "$(dirname "$0")/.."

publish=false
build=true
for arg in "$@"; do
  case $arg in
    --publish) publish=true ;;
    --skip-build) build=false ;;
    -h | --help) sed -n '2,10p' "$0" | cut -c3-; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

fail() { echo "error: $*" >&2; exit 1; }

repo=AmoabaKelvin/keylight
version=$(node -p "require('./src-tauri/tauri.conf.json').version")
tag="v$version"
key=${KEYLIGHT_UPDATER_KEY:-$HOME/.tauri/keylight-updater.key}
bundle=${BUNDLE_DIR:-src-tauri/target/universal-apple-darwin/release/bundle/macos}
out="src-tauri/target/release-files/$tag"

if $publish; then
  gh auth status >/dev/null 2>&1 || fail "gh isn't logged in"
  [ -z "$(git status --porcelain)" ] || fail "the working tree has uncommitted changes"
  [ -n "$(git branch -r --contains HEAD)" ] || fail "push this commit first; the release tag points at it"
fi

if $build; then
  for target in aarch64-apple-darwin x86_64-apple-darwin; do
    rustup target list --installed | grep -qx "$target" ||
      fail "Rust target $target is missing. Run: rustup target add aarch64-apple-darwin x86_64-apple-darwin"
  done
  [ -f "$key" ] || fail "no updater key at $key"
  pnpm install --frozen-lockfile
  # The CLI takes a path here as well as the key itself, so the key never lands in the environment.
  TAURI_SIGNING_PRIVATE_KEY="$key" TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" \
    pnpm tauri build --target universal-apple-darwin --bundles app
fi

app="$bundle/Keylight.app"
[ -d "$app" ] || fail "no build at $app"
[ -f "$bundle/Keylight.app.tar.gz.sig" ] || fail "no updater signature in $bundle; was the key set when it was built?"

built=$(plutil -extract CFBundleShortVersionString raw "$app/Contents/Info.plist")
[ "$built" = "$version" ] || fail "the build is $built but tauri.conf.json says $version"
signed=$(base64 -d -i "$bundle/Keylight.app.tar.gz.sig" | sed -n 's/.*version:\([^[:space:]]*\).*/\1/p')
[ "$signed" = "$version" ] || fail "the updater signature is for ${signed:-no version}, not $version"

archs=$(lipo -archs "$app/Contents/MacOS/keylight")
case $archs in
  *x86_64*arm64* | *arm64*x86_64*) ;;
  *)
    $publish && fail "the build is $archs only; a release has to be universal"
    echo "warning: the build is $archs only, not universal" >&2
    ;;
esac

rm -rf "$out"
mkdir -p "$out"
zip="Keylight-$version-universal.zip"
updater="Keylight_${version}_universal.app.tar.gz"
ditto -c -k --keepParent "$app" "$out/$zip"
cp "$bundle/Keylight.app.tar.gz" "$out/$updater"
cp "$bundle/Keylight.app.tar.gz.sig" "$out/$updater.sig"

# Both Mac architectures get the universal bundle. The updater reads the endpoint
# releases/latest/download/latest.json (tauri.conf.json).
SIG="$(cat "$out/$updater.sig")" \
  URL="https://github.com/$repo/releases/download/$tag/$updater" \
  VERSION="$version" \
  node -e '
    const { SIG: signature, URL: url, VERSION: version } = process.env
    const platform = { signature, url }
    const json = {
      version,
      notes: `Keylight ${version}`,
      pub_date: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
      platforms: { "darwin-aarch64": platform, "darwin-x86_64": platform },
    }
    process.stdout.write(JSON.stringify(json, null, 2) + "\n")
  ' >"$out/latest.json"

cat >"$out/notes.md" <<EOF
**Requirements:** a Mac on macOS 13 or later (Apple silicon or Intel) and an Air75 V3 connected with the USB cable. The 2.4G dongle and Bluetooth can't carry settings.

**First launch:** the app isn't notarised. Unzip it, move it to Applications and open it once. Then go to System Settings → Privacy & Security and click Open Anyway.

**Updating:** from 0.2.0 on, Keylight updates itself from Device → Updates or the menu bar menu. On 0.1.0, download this one by hand.

Unofficial; not affiliated with NuPhy.
EOF

echo
echo "Keylight $version ($archs) in $out:"
(cd "$out" && ls -l | sed 1d)
echo "$zip sha256 (for the Homebrew cask): $(shasum -a 256 "$out/$zip" | cut -d' ' -f1)"

files="$out/$zip $out/$updater $out/$updater.sig"
if ! $publish; then
  echo
  echo "Dry run. With --publish this would run:"
  if gh release view "$tag" -R "$repo" >/dev/null 2>&1; then
    echo "  gh release upload $tag $files $out/latest.json --clobber"
  else
    echo "  gh release create $tag $files --draft --title 'Keylight $version' --notes-file $out/notes.md --generate-notes --target $(git rev-parse --short HEAD)"
    echo "  gh release upload $tag $out/latest.json"
    echo "  gh release edit $tag --draft=false --latest"
  fi
  exit 0
fi

# latest.json goes up last, so running apps never see an update whose files are missing.
# shellcheck disable=SC2086
if gh release view "$tag" -R "$repo" >/dev/null 2>&1; then
  gh release upload "$tag" $files -R "$repo" --clobber
  gh release upload "$tag" "$out/latest.json" -R "$repo" --clobber
else
  gh release create "$tag" $files -R "$repo" --draft --title "Keylight $version" \
    --notes-file "$out/notes.md" --generate-notes --target "$(git rev-parse HEAD)"
  gh release upload "$tag" "$out/latest.json" -R "$repo"
  gh release edit "$tag" -R "$repo" --draft=false --latest
fi
gh release view "$tag" -R "$repo" --json url -q .url
