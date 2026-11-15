# Butler.Site - pilot landing page

A one-page landing page for the Butler pilot (#134). It tells the Tuesday-at-the-hub story from the
[Product Vision](../Butler.KnowledgeBase/docs/10-product-vision.md), shows the three v1 capabilities,
holds a slot for the demo clip, and asks families to join the pilot.

It is plain, hand-written HTML and CSS. There is no JavaScript, no framework, no build step and no
external request (no web fonts, analytics or embeds), so the page works straight from disk and from the
GitHub Pages project path.

## Files

| File | What |
| --- | --- |
| `index.html` | The page. |
| `styles.css` | The stylesheet. Colours are design-token values only (see Colours). |
| `ci/check-site.sh` | Static checks run by CI (see Checks). |
| `ci/check-layout.mjs` | Viewport layout check run by CI (see Checks). |
| `ci/check-layout.test.mjs` | Shutdown test for `check-layout.mjs`, run by CI (see Checks). |
| `ci/stub-chrome.mjs` | Stub Chrome the shutdown test runs `check-layout.mjs` against. |
| `.gitattributes` | Keeps `*.sh` at LF line endings. |

## Sign-up

Sign-up is a single `mailto:` link in the "Join the pilot" section. Activating it opens the visitor's own
email app with the subject "Butler pilot sign-up" filled in. There is no account, no form, no backend and
no third-party form service, so no prospect's personal details leave their own mail client until they
choose to send the email. The page stores nothing.

The recipient is a placeholder, `pilot@example.com`. It appears in exactly one place: the `href` of the
"Email us to join the pilot" link in `index.html`, directly after a `PLACEHOLDER` comment. The owner
replaces it with the real pilot address. The header and hero buttons only jump to that section.

## Preview locally

Open `Butler.Site/index.html` directly in a browser, or serve the folder:

```bash
python3 -m http.server 4173 --directory Butler.Site
```

Then open http://localhost:4173/.

## Checks

```bash
bash Butler.Site/ci/check-site.sh
```

It checks that the page is static (no script, style block or inline style, no external loads), that the
story, capabilities, demo-clip and pilot sections are present, that every colour is a design token, that
there is exactly one `mailto:` link with the pilot subject, and that every file is plain ASCII. CI runs
it on every pull request that touches `Butler.Site/`.

```bash
node Butler.Site/ci/check-layout.mjs
```

It loads the page in headless Chrome at 375 x 800 and 1280 x 800 and fails if the page scrolls
horizontally at either width (scrollWidth wider than the viewport, or any element past an edge), if the
capabilities grid is not one column with the cards stacked at 375px, or if it is not three columns on
one row at 1280px. It has no dependencies (Node 18+ built-ins only, talking to Chrome over
`--remote-debugging-pipe`). It uses `CHROME_PATH` if set, otherwise `google-chrome` or `chromium` on
`PATH`; CI runs it after `check-site.sh` on the runner's preinstalled Chrome. Its shutdown is bounded:
after the checks it waits at most 5 s for Chrome to exit after `Browser.close`, then kills it.

```bash
node --test Butler.Site/ci/check-layout.test.mjs
```

No Chrome needed: it runs `check-layout.mjs` against `ci/stub-chrome.mjs` and proves the script exits
within 15 s, with its normal pass/fail result, when Chrome never answers `Browser.close`. CI runs it
after the layout check.

Accessibility is checked by hand with the Lighthouse CLI against the locally served page (it needs a
Chrome or Chromium binary in `CHROME_PATH`):

```bash
npx --yes lighthouse@12 http://localhost:4173/ --only-categories=accessibility \
  --chrome-flags="--headless=new --no-sandbox" --output=json --output-path=./lh-mobile.json --quiet
npx --yes lighthouse@12 http://localhost:4173/ --preset=desktop --only-categories=accessibility \
  --chrome-flags="--headless=new --no-sandbox" --output=json --output-path=./lh-desktop.json --quiet
jq '.categories.accessibility.score * 100' ./lh-mobile.json ./lh-desktop.json
```

Keep the reports out of the repo.

## Colours

`styles.css` defines every colour once, as CSS custom properties in two `:root` blocks: light values
from `colors` and dark values (under `prefers-color-scheme: dark`) from `colors_dark` in
[`Butler.UI/design-tokens.json`](../Butler.UI/design-tokens.json). The rest of the stylesheet uses only
`var(--...)`. Because there is no build step the values are copied by hand, and `check-site.sh` fails if
any colour is not a token value.

Known limit: the workflow only runs on changes under `Butler.Site/`, so changing a design token does not
re-run the check. If a token value changes, update `styles.css` and the check will confirm it.

## Deploy

[`.github/workflows/site-pages.yml`](../.github/workflows/site-pages.yml) runs `check-site.sh` on every
pull request and push that touches `Butler.Site/`. On a push to `main` (or a manual run) it then publishes
`index.html` and `styles.css` to GitHub Pages. Pull requests never deploy.

One-time owner step: in the repository's Settings > Pages, set Source to "GitHub Actions", then run the
`site-pages` workflow from the Actions tab. Until Pages is enabled, the deploy job fails at
`configure-pages`; the check job is unaffected. The live URL is
https://jasoncavaliere.github.io/the-butler-did-it/.

## Demo clip

The "See it in action" section is a placeholder until the demo clip from #135 is recorded. Look for the
`DEMO CLIP SLOT` comment in `index.html`.
