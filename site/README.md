# Keylight website

The site at [nuphy.kelvinamoaba.com](https://nuphy.kelvinamoaba.com). It's a static Vite and React page, served by Cloudflare Workers static assets.

It reuses the app instead of copying it:

- The hero keyboard is the app's own `Keyboard` component, with `layout.ts`, `compose.ts`, `keycodes.ts` and the shape presets, imported from `../src`.
- The colours, fonts and keyboard styles come from the app's `../src/index.css`. `src/site.css` only lays out the page.
- The screenshots and recordings are the ones in `../docs/screenshots/`, which the README also uses. The dark-mode copies and the video posters are in `src/assets/`.

## Develop

```sh
cd site
pnpm install
pnpm dev        # http://localhost:4323
pnpm check      # type-check
pnpm build      # writes dist/
pnpm preview    # serves dist/ on http://localhost:4323
```

## Deploy

The first time, log in to the Cloudflare account that has the `kelvinamoaba.com` zone:

```sh
pnpm exec wrangler login
```

Then build and deploy:

```sh
pnpm run deploy   # vite build && wrangler deploy
```

`wrangler.jsonc` names the Worker `keylight-site` and serves `dist/` as static assets. Unknown paths get `dist/404.html`.

### Custom domain

`wrangler.jsonc` has a route with `"custom_domain": true` for `nuphy.kelvinamoaba.com`. On deploy, Wrangler attaches the hostname to the Worker and creates the DNS record and certificate. It only works if `kelvinamoaba.com` is a zone in the same Cloudflare account, and no other DNS record already uses `nuphy`.

To attach it by hand instead, remove `routes` from `wrangler.jsonc`, deploy, then open Workers & Pages › `keylight-site` › Settings › Domains & Routes › Add › Custom domain, and enter `nuphy.kelvinamoaba.com`.

## Updating the screenshots

The screenshots and clips were captured headlessly with Playwright against the dev UI (`pnpm dev` in the app), with every `/api/**` request answered from fixtures, so nothing reached the keyboard. Keep the file names in `../docs/screenshots/` (`lighting.png`, `shapes.png`, `side.png`, `keymap.png`, `hyper.png`, `karabiner.png`, `device.png`, `themes.mp4`, `paint.mp4`, `hyper.mp4`), since the README and this site link to them.
