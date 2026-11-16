#!/usr/bin/env bash
# Static checks for the pilot landing page (#134): Butler.Site/index.html,
# Butler.Site/styles.css and Butler.Site/README.md.
#
# Usage: bash Butler.Site/ci/check-site.sh
#
#   1. The site files and Butler.UI/design-tokens.json exist.
#   2. Plain static HTML/CSS (AC1): no <script>, no <style>, no inline style=,
#      a relative stylesheet link, no root-absolute or external src/stylesheet
#      loads, and no @import or url() in the stylesheet.
#   3. The content is there (AC2): the story, capabilities, byo-tablet,
#      demo-clip and pilot sections, two sentences of the Tuesday-at-the-hub
#      story, and exactly three capabilities. The BYO-tablet section (#249)
#      sits between capabilities and demo-clip, names Android and iPad, gives a
#      one- or two-sentence safety paragraph (permanent power, charge cap,
#      kiosk app or single-app mode), names no brand beyond the article's F4
#      examples, uses only classes styles.css defines, and links the
#      BYO-tablet setup guidance article.
#   4. Token colours only (AC3): every hex colour in styles.css is a value from
#      design-tokens.json colors or colors_dark; no colour functions, no named
#      colours, and no hex colour in index.html.
#   5. Sign-up is one mailto: link (AC4) with a Butler pilot subject, the
#      placeholder address appears once outside HTML comments, and there is
#      no <form>.
#   6. The viewport meta and <html lang="en"> are present.
#   7. The README covers sign-up and local preview (AC7).
#   8. Every file under Butler.Site/ is plain ASCII.
#
# Each failure prints a reason to stderr and exits 1. Needs bash, jq, perl and
# GNU grep (for -P).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SITE="$REPO_ROOT/Butler.Site"
HTML="$SITE/index.html"
CSS="$SITE/styles.css"
README="$SITE/README.md"
TOKENS="$REPO_ROOT/Butler.UI/design-tokens.json"

fail() {
  echo "check-site: $*" >&2
  exit 1
}

# count <extended-regex> <file>: number of matches (0 when none, never fails).
count() {
  { grep -oE "$1" "$2" || true; } | wc -l | tr -d ' '
}

# 1. Files exist.
for f in "$HTML" "$CSS" "$README" "$TOKENS"; do
  [ -f "$f" ] || fail "missing $f"
done

# 2. AC1: static HTML/CSS, no framework, no external loads.
if grep -niE '<script|<style| style=' "$HTML" >&2; then
  fail "index.html has a script, style block or inline style (lines above)"
fi
grep -qF 'href="styles.css"' "$HTML" || fail 'index.html does not link the relative stylesheet href="styles.css"'
if grep -nE '(src|href)="/' "$HTML" >&2; then
  fail "index.html has a root-absolute src or href (lines above); use relative URLs"
fi
if grep -niE 'src="http|<link[^>]*href="http' "$HTML" >&2; then
  fail "index.html loads an external resource (lines above)"
fi
if grep -niE '@import|url\(' "$CSS" >&2; then
  fail "styles.css has @import or url() (lines above)"
fi

# 3. AC2: the story, the three capabilities, the clip slot and the pilot CTA.
for id in story capabilities byo-tablet demo-clip pilot; do
  grep -qF "id=\"$id\"" "$HTML" || fail "index.html has no section id=\"$id\""
done
for sentence in 'It is 7:15 on a Tuesday.' 'That glance is the product.'; do
  grep -qF "$sentence" "$HTML" || fail "index.html is missing the story sentence '$sentence'"
done
caps="$(count 'class="capability"' "$HTML")"
[ "$caps" -eq 3 ] || fail "index.html has $caps class=\"capability\" items, expected exactly 3"

# 3b. #249: the BYO-tablet section, between capabilities and demo-clip.
grep -qF 'id="byo-tablet" class="section" aria-labelledby="byo-tablet-title"' "$HTML" \
  || fail 'the byo-tablet section is not class="section" aria-labelledby="byo-tablet-title"'
grep -qF '<h2 id="byo-tablet-title">Works on the tablet you own</h2>' "$HTML" \
  || fail 'index.html has no <h2 id="byo-tablet-title">Works on the tablet you own</h2>'
guide_url='https://github.com/jasoncavaliere/the-butler-did-it/blob/main/Butler.KnowledgeBase/docs/17-byo-tablet-setup-guidance.md'
grep -qF "href=\"$guide_url\"" "$HTML" || fail "index.html does not link the BYO-tablet setup guide $guide_url"
for word in Android iPad; do
  grep -qF "$word" "$HTML" || fail "index.html does not name '$word' tablets"
done
line_of() { grep -nF "id=\"$1\"" "$HTML" | head -n1 | cut -d: -f1; }
cap_line="$(line_of capabilities)"
byo_line="$(line_of byo-tablet)"
clip_line="$(line_of demo-clip)"
[ "$cap_line" -lt "$byo_line" ] && [ "$byo_line" -lt "$clip_line" ] \
  || fail "the byo-tablet section must sit between #capabilities and #demo-clip"
# The section's markup, from its <section> line to the next </section>.
byo_html="$(awk '/<section id="byo-tablet"/ { on = 1 } on { print } on && /<\/section>/ { exit }' "$HTML")"
[ -n "$byo_html" ] || fail "could not read the byo-tablet section markup"
# Its visible copy: tags stripped, whitespace collapsed.
byo_text="$(printf '%s\n' "$byo_html" | perl -0pe 's{<!--.*?-->}{}gs; s{<[^>]*>}{ }g; s{\s+}{ }g')"
# AC2a: one paragraph of one or two sentences covers permanent power, the
# battery charge cap and locking the tablet to Butler.
safety="$(printf '%s\n' "$byo_html" | perl -0ne 'while (m{<p>(.*?)</p>}gs) { my $p = $1; if ($p =~ /permanent power/ && $p =~ /charge cap/ && $p =~ /kiosk app|single-app mode/) { print "$p\n"; last } }')"
[ -n "$safety" ] \
  || fail "the byo-tablet section has no paragraph covering 'permanent power', 'charge cap' and lockdown ('kiosk app' or 'single-app mode')"
sentences="$(printf '%s' "$safety" | { grep -oE '[.!?]([[:space:]]|$)' || true; } | wc -l | tr -d ' ')"
[ "$sentences" -ge 1 ] && [ "$sentences" -le 2 ] \
  || fail "the byo-tablet safety paragraph has $sentences sentences, expected one or two"
# AC3: the copy names no brand beyond Android and iPad (#249 AC1) and the
# article's F4 examples (Lenovo Tab M11, Samsung Galaxy Tab A9+). Every word
# with a capital letter must be on this list; add ordinary sentence-start
# words here, never another brand.
byo_caps_allowed='Works Butler There Because Read Android iPad Lenovo Samsung Galaxy Tab M11 A9'
bad_caps=""
for w in $(printf '%s\n' "$byo_text" | { grep -oE "[A-Za-z0-9]*[A-Z][A-Za-z0-9]*" || true; } | sort -u); do
  case " $byo_caps_allowed " in
    *" $w "*) ;;
    *) bad_caps="$bad_caps $w" ;;
  esac
done
[ -z "$bad_caps" ] \
  || fail "the byo-tablet copy has capitalised words that are not allowed (brands beyond Android, iPad and the F4 examples?):$bad_caps"
# AC4: the section uses only classes that styles.css defines.
for cls in $(printf '%s\n' "$byo_html" | { grep -oE 'class="[^"]*"' || true; } | sed -E 's/^class="//; s/"$//' | tr ' ' '\n' | sort -u); do
  grep -qE "\.$cls([^A-Za-z0-9_-]|$)" "$CSS" \
    || fail "the byo-tablet section uses class \"$cls\", which styles.css does not define"
done

# 4. AC3: every colour is a design-token value.
allowed="$(jq -r '(.colors, .colors_dark) | to_entries[] | .value | ascii_upcase' "$TOKENS")"
css_no_comments="$(perl -0pe 's{/\*.*?\*/}{}gs' "$CSS")"
hexes="$(printf '%s\n' "$css_no_comments" | { grep -oE '#[0-9A-Fa-f]{3,8}\b' || true; } | tr '[:lower:]' '[:upper:]')"
[ -n "$hexes" ] || fail "styles.css has no hex colours; expected the token custom properties"
bad=0
while IFS= read -r hex; do
  if ! printf '%s\n' "$allowed" | grep -qxF "$hex"; then
    echo "check-site: styles.css colour $hex is not in design-tokens.json colors/colors_dark" >&2
    bad=1
  fi
done <<< "$hexes"
[ "$bad" -eq 0 ] || fail "styles.css uses colours that are not design tokens (listed above)"
if printf '%s\n' "$css_no_comments" | grep -niE '\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix)\(' >&2; then
  fail "styles.css uses a colour function (lines above); use token hex values"
fi
if printf '%s\n' "$css_no_comments" | grep -niE ':[^;{}]*\b(white|black|red|green|blue|gray|grey|silver|navy|teal|orange|yellow|purple|pink|brown|transparent)\b' >&2; then
  fail "styles.css uses a named colour (lines above); use token values"
fi
if grep -nE '#[0-9A-Fa-f]{6}\b' "$HTML" >&2; then
  fail "index.html has a hex colour (lines above); colours belong in styles.css"
fi

# 5. AC4: one mailto with a prefilled Butler pilot subject, no form.
mailtos="$(count 'href="mailto:' "$HTML")"
[ "$mailtos" -eq 1 ] || fail "index.html has $mailtos mailto: links, expected exactly 1"
grep -qE 'href="mailto:[^"?]+\?subject=Butler%20pilot' "$HTML" \
  || fail 'the mailto: link has no ?subject=Butler%20pilot... subject'
# Count outside HTML comments: the PLACEHOLDER comment names the address too.
placeholders="$(perl -0pe 's{<!--.*?-->}{}gs' "$HTML" | { grep -oF 'pilot@example.com' || true; } | wc -l | tr -d ' ')"
[ "$placeholders" -eq 1 ] || fail "pilot@example.com appears $placeholders times in index.html markup, expected exactly 1"
if grep -niE '<form' "$HTML" >&2; then
  fail "index.html has a <form>; sign-up is a mailto: link only"
fi

# 6. Viewport and language.
grep -qF '<meta name="viewport" content="width=device-width, initial-scale=1">' "$HTML" \
  || fail "index.html is missing the viewport meta"
grep -qF '<html lang="en">' "$HTML" || fail 'index.html is missing <html lang="en">'

# 7. AC7: the README covers sign-up and local preview.
grep -qF 'mailto:' "$README" || fail "README.md does not mention 'mailto:'"
grep -qi 'no account' "$README" || fail "README.md does not say 'no account'"
grep -qF 'python3 -m http.server' "$README" || fail "README.md does not show 'python3 -m http.server'"
grep -qF 'pilot@example.com' "$README" || fail "README.md does not name the placeholder pilot@example.com"

# 8. Plain ASCII.
while IFS= read -r -d '' f; do
  if LC_ALL=C grep -nP '[^\x00-\x7F]' "$f" >&2; then
    fail "$f has non-ASCII characters (lines above)"
  fi
done < <(find "$SITE" -type f -print0)

echo "check-site: OK"
