#!/usr/bin/env python3
"""Convert the Butler knowledge base into GitHub wiki pages (issue #360).

The Markdown under Butler.KnowledgeBase/ is canonical. This script renders it
into a flat GitHub wiki tree that .github/workflows/kb-wiki.yml pushes to the
repo's wiki on every push to main. Wiki edits are overwritten.

Run from the repo root:

    python3 Butler.KnowledgeBase/tools/publish_wiki.py --out <dir>

What it does:
  - one wiki page per published .md file (everything except intake/, tools/
    and assets/); root index.md becomes Home.md, and names that collide in the
    flat, case-insensitive wiki namespace get the file's path with / -> -
    (brd/index.md -> brd-index.md);
  - rewrites relative links to published pages into wiki page names (anchor
    kept), links to other repo files into GitHub blob/tree URLs, and
    assets/ links into the copied assets/ folder; code spans and fenced
    blocks are left alone;
  - replaces OKF frontmatter with an H1 (when the body has none), the
    description as a lead line, and a trailing Related and Sources list;
  - writes _Sidebar.md (from the root index) and _Footer.md;
  - copies Butler.KnowledgeBase/assets/ to <out>/assets/.

Exit codes: 0 ok, 1 broken links (each printed to stderr as file:line),
2 usage error (for example, --out exists and is not empty).

Stdlib only, deterministic (sorted traversal, no timestamps), plain ASCII.
"""
import argparse
import json
import os
import re
import shutil
import sys
from pathlib import Path, PurePosixPath
from urllib.parse import unquote

REPO_URL = "https://github.com/jasoncavaliere/the-butler-did-it"
BLOB_BASE = REPO_URL + "/blob/main/"
TREE_BASE = REPO_URL + "/tree/main/"
ASSET_PREFIX = "assets/"
WORKFLOW = ".github/workflows/kb-wiki.yml"

EXCLUDED_TOP = {"intake", "tools", "assets"}
RESERVED = {"home", "_sidebar", "_footer"}
FLOW_MAP_SPLIT = re.compile(r",\s*(?=(?:id|resource|title)\s*:)")
SCHEME = re.compile(r"^[A-Za-z][A-Za-z0-9+.-]*:")
FENCE = re.compile(r"^ {0,3}(`{3,}|~{3,})")
LINK = re.compile(
    r"(!?)\[([^\]\n]*)\]\("
    r"(<[^>\n]*>|[^\s()]*(?:\([^\s()]*\)[^\s()]*)*)"
    r"(\s+\"[^\"\n]*\")?\)"
)


# ---------------------------------------------------------------- pages


def collect_pages(kb_dir):
    """Published .md files as sorted POSIX paths relative to the KB."""
    pages = []
    for path in kb_dir.rglob("*.md"):
        rel = path.relative_to(kb_dir).as_posix()
        if rel.split("/")[0] in EXCLUDED_TOP or not path.is_file():
            continue
        pages.append(rel)
    return sorted(pages)


def name_pages(pages):
    """Map each relative path to a unique wiki page name (case-insensitive)."""
    groups = {}
    for rel in pages:
        groups.setdefault(PurePosixPath(rel).stem.lower(), []).append(rel)
    names, used, pending = {}, set(), []
    for rel in pages:
        stem = PurePosixPath(rel).stem
        if rel == "index.md":
            cand = "Home"
        elif len(groups[stem.lower()]) == 1 and stem.lower() not in RESERVED:
            cand = stem
        else:
            pending.append(rel)
            continue
        names[rel] = cand
        used.add(cand.lower())
    for rel in pending:
        base = rel[:-3].replace("/", "-")
        cand, n = base, 2
        while cand.lower() in used or cand.lower() in RESERVED:
            cand = "%s-%d" % (base, n)
            n += 1
        names[rel] = cand
        used.add(cand.lower())
    return names


# ---------------------------------------------------------- frontmatter


def _split_flow(inner):
    """Split a flow list body on commas outside quotes."""
    items, buf, quote = [], "", None
    for ch in inner:
        if quote:
            buf += ch
            if ch == quote:
                quote = None
        elif ch in "\"'":
            quote = ch
            buf += ch
        elif ch == ",":
            items.append(buf)
            buf = ""
        else:
            buf += ch
    items.append(buf)
    return [i.strip() for i in items if i.strip()]


def _flow_map(inner):
    out = {}
    for part in FLOW_MAP_SPLIT.split(inner):
        key, sep, value = part.partition(":")
        if sep:
            out[key.strip()] = parse_scalar(value.strip().rstrip(",").strip())
    return out


def parse_scalar(value):
    value = value.strip()
    if len(value) >= 2 and value[0] == '"' and value[-1] == '"':
        try:
            return json.loads(value)
        except ValueError:
            return value[1:-1]
    if len(value) >= 2 and value[0] == "'" and value[-1] == "'":
        return value[1:-1].replace("''", "'")
    if value.startswith("[") and value.endswith("]"):
        return [parse_scalar(i) for i in _split_flow(value[1:-1])]
    if value.startswith("{") and value.endswith("}"):
        return _flow_map(value[1:-1])
    return value


def parse_page(text):
    """Return (frontmatter, fm_lines, body) where body is [(lineno, line)].

    fm_lines maps a top-level key to its line number, and a block-list key to
    a list of line numbers parallel to its items.
    """
    lines = text.split("\n")
    if text.endswith("\n"):
        lines = lines[:-1]
    fm, fm_lines = {}, {}
    start = 0
    if text.startswith("---\n"):
        end = None
        for i in range(1, len(lines)):
            if lines[i].rstrip() == "---":
                end = i
                break
        if end is not None:
            key = None
            for i in range(1, end):
                line = lines[i]
                lineno = i + 1
                if not line.strip() or line.lstrip().startswith("#"):
                    continue
                if not line[0].isspace():
                    k, sep, v = line.partition(":")
                    if not sep:
                        continue
                    key = k.strip()
                    v = v.strip()
                    if v:
                        fm[key] = parse_scalar(v)
                        fm_lines[key] = lineno
                    else:
                        fm[key] = []
                        fm_lines[key] = []
                elif key and line.lstrip().startswith("- ") and isinstance(fm.get(key), list):
                    if not isinstance(fm_lines.get(key), list):
                        continue
                    fm[key].append(parse_scalar(line.lstrip()[2:]))
                    fm_lines[key].append(lineno)
            start = end + 1
    body = [(i + 1, lines[i]) for i in range(start, len(lines))]
    return fm, fm_lines, body


# ---------------------------------------------------------------- links


def mask_code_spans(line):
    """Replace inline code spans with NULs of the same length."""
    out, i, n = [], 0, len(line)
    while i < n:
        if line[i] == "`":
            j = i
            while j < n and line[j] == "`":
                j += 1
            run = line[i:j]
            k = j
            close = -1
            while k < n:
                if line[k] == "`":
                    m = k
                    while m < n and line[m] == "`":
                        m += 1
                    if m - k == len(run):
                        close = k
                        break
                    k = m
                else:
                    k += 1
            if close < 0:
                out.append(run)
                i = j
            else:
                end = close + len(run)
                out.append("\0" * (end - i))
                i = end
        else:
            out.append(line[i])
            i += 1
    return "".join(out)


class Converter:
    def __init__(self, kb_dir, repo_root):
        self.kb = Path(os.path.normpath(str(Path(kb_dir).resolve())))
        self.root = Path(os.path.normpath(str(Path(repo_root).resolve())))
        self.pages = collect_pages(self.kb)
        self.names = name_pages(self.pages)
        self.parsed = {}
        for rel in self.pages:
            text = (self.kb / rel).read_text(encoding="utf-8")
            self.parsed[rel] = parse_page(text)
        self.by_stem, self.by_id = {}, {}
        for rel in self.pages:
            self.by_stem.setdefault(PurePosixPath(rel).stem, []).append(rel)
            fid = self.parsed[rel][0].get("id")
            if isinstance(fid, str) and fid:
                self.by_id.setdefault(fid, []).append(rel)
        self.broken = []

    def repo_rel(self, path):
        return Path(path).relative_to(self.root).as_posix()

    def src_label(self, rel):
        return self.repo_rel(self.kb / rel)

    def report(self, rel, lineno, message):
        self.broken.append((self.src_label(rel), lineno, message))

    def resolve(self, target, src_rel):
        """Rewrite one link target; return None when it is broken."""
        if not target or target.startswith("#") or SCHEME.match(target):
            return target
        path, sep, anchor = target.partition("#")
        suffix = sep + anchor
        if not path:
            return target
        fs_path = unquote(path)
        if fs_path.startswith("/"):
            joined = os.path.join(str(self.kb), fs_path.lstrip("/"))
        else:
            joined = os.path.join(str((self.kb / src_rel).parent), fs_path)
        p = Path(os.path.normpath(joined))
        try:
            repo_rel = p.relative_to(self.root).as_posix()
        except ValueError:
            return None
        if not p.exists():
            return None
        try:
            kb_rel = p.relative_to(self.kb).as_posix()
        except ValueError:
            kb_rel = None
        if kb_rel is not None:
            if p.is_file() and kb_rel in self.names:
                return self.names[kb_rel] + suffix
            if p.is_file() and kb_rel.startswith(ASSET_PREFIX):
                return kb_rel + suffix
            if p.is_dir():
                for leaf in ("index.md", "README.md"):
                    cand = leaf if kb_rel == "." else kb_rel + "/" + leaf
                    if cand in self.names:
                        return self.names[cand] + suffix
        if p.is_dir():
            return TREE_BASE + ("" if repo_rel == "." else repo_rel) + suffix
        return BLOB_BASE + repo_rel + suffix

    def rewrite_line(self, line, src_rel, lineno, record=True):
        masked = mask_code_spans(line)
        out, pos = [], 0
        for m in LINK.finditer(masked):
            raw = line[m.start(3):m.end(3)]
            angle = raw.startswith("<") and raw.endswith(">")
            target = raw[1:-1] if angle else raw
            new = self.resolve(target, src_rel)
            if new is None:
                if record:
                    self.report(src_rel, lineno, "broken link '%s'" % target)
                continue
            new_raw = "<%s>" % new if angle else new
            out.append(line[pos:m.start(3)])
            out.append(new_raw)
            pos = m.end(3)
        out.append(line[pos:])
        return "".join(out)

    def rewrite_body(self, body, src_rel):
        """Rewrite links outside fences; return (lines, h1_index or None)."""
        out, fence, h1 = [], None, None
        for lineno, line in body:
            m = FENCE.match(line)
            if fence:
                if m and m.group(1)[0] == fence[0] and len(m.group(1)) >= len(fence) \
                        and not line[m.end():].strip():
                    fence = None
                out.append(line)
                continue
            if m:
                fence = m.group(1)
                out.append(line)
                continue
            if h1 is None and line.startswith("# "):
                h1 = len(out)
            out.append(self.rewrite_line(line, src_rel, lineno))
        return out, h1

    # ------------------------------------------------------------ render

    def page_title(self, rel):
        title = self.parsed[rel][0].get("title")
        return title if isinstance(title, str) and title else self.names[rel]

    def resolve_slug(self, slug):
        for table in (self.by_stem, self.by_id):
            hits = table.get(slug, [])
            if len(hits) == 1:
                return hits[0]
        return None

    @staticmethod
    def link_text(text):
        return text.replace("[", "\\[").replace("]", "\\]")

    @staticmethod
    def link_dest(dest):
        return "<%s>" % dest if re.search(r"[\s()<>]", dest) else dest

    def render(self, rel):
        fm, fm_lines, body = self.parsed[rel]
        lines, h1 = self.rewrite_body(body, rel)
        title = fm.get("title") if isinstance(fm.get("title"), str) else ""
        desc = fm.get("description") if isinstance(fm.get("description"), str) else ""
        lead = "*%s*" % desc.replace("*", "\\*") if desc else ""

        def strip_leading(ls):
            i = 0
            while i < len(ls) and not ls[i].strip():
                i += 1
            return ls[i:]

        stripped = strip_leading(lines)
        if h1 is not None:
            h1 -= len(lines) - len(stripped)
        lines = stripped
        if h1 is None and title:
            head = ["# " + title, ""] + ([lead, ""] if lead else [])
            lines = head + strip_leading(lines)
        elif h1 is not None and lead:
            lines = lines[:h1 + 1] + ["", lead, ""] + strip_leading(lines[h1 + 1:])
        else:
            lines = strip_leading(lines)
        while lines and not lines[-1].strip():
            lines.pop()

        trailer = []
        related = fm.get("related")
        if isinstance(related, list) and related:
            # fm_lines["related"] is one int (the key line) for a flow list, or a
            # list of per-item lines for a block list.
            rel_lines = fm_lines.get("related")
            items = []
            for idx, slug in enumerate(related):
                if not isinstance(slug, str):
                    continue
                target = self.resolve_slug(slug)
                if target is None:
                    if isinstance(rel_lines, list):
                        lineno = rel_lines[idx] if idx < len(rel_lines) else 0
                    elif isinstance(rel_lines, int):
                        lineno = rel_lines
                    else:
                        lineno = 0
                    self.report(rel, lineno, "broken link '%s' (related)" % slug)
                    continue
                items.append("- [%s](%s)" % (self.link_text(self.page_title(target)),
                                             self.names[target]))
            if items:
                trailer += ["**Related**", ""] + items + [""]
        sources = fm.get("sources")
        if isinstance(sources, list) and sources:
            item_lines = fm_lines.get("sources") or []
            items = []
            for idx, src in enumerate(sources):
                lineno = item_lines[idx] if idx < len(item_lines) else 0
                if isinstance(src, dict):
                    label = src.get("title") or src.get("id") or src.get("resource") or ""
                    resource = src.get("resource") or ""
                else:
                    label, resource = str(src), ""
                label = self.link_text(str(label))
                if not resource:
                    items.append("- " + label)
                    continue
                new = self.resolve(str(resource), rel)
                if new is None:
                    self.report(rel, lineno, "broken link '%s' (source)" % resource)
                    items.append("- " + label)
                    continue
                items.append("- [%s](%s)" % (label, self.link_dest(new)))
            if items:
                trailer += ["**Sources**", ""] + items + [""]
        if trailer:
            lines += ["", "---", ""] + trailer
            while lines and not lines[-1].strip():
                lines.pop()
        return "\n".join(lines) + "\n"

    def sidebar(self):
        lines = ["[Home](Home)"]
        if "index.md" in self.parsed:
            for lineno, line in self.parsed["index.md"][2]:
                h = re.match(r"^# (.+?)\s*$", line)
                if h:
                    lines += ["", "**%s**" % h.group(1), ""]
                    continue
                m = re.match(r"^\* \[([^\]]+)\]\(([^)\s]+)\)", line)
                if m:
                    target = self.resolve(m.group(2), "index.md")
                    lines.append("* [%s](%s)" % (m.group(1), target or m.group(2)))
        return "\n".join(lines) + "\n"

    def footer(self):
        kb_rel = self.repo_rel(self.kb)
        return (
            "This wiki is generated from [%s](%s%s) by `%s`. "
            "Do not edit it here: every publish overwrites wiki edits. "
            "Change the repo instead.\n" % (kb_rel, TREE_BASE, kb_rel, WORKFLOW)
        )


def write_text(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text.rstrip("\n") + "\n")


def convert(kb_dir, out_dir, repo_root):
    """Render the KB into out_dir; return the sorted broken-link lines."""
    conv = Converter(kb_dir, repo_root)
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    for rel in conv.pages:
        write_text(out / (conv.names[rel] + ".md"), conv.render(rel))
    write_text(out / "_Sidebar.md", conv.sidebar())
    write_text(out / "_Footer.md", conv.footer())
    assets = conv.kb / "assets"
    if assets.is_dir():
        for path in sorted(p for p in assets.rglob("*") if p.is_file()):
            dest = out / "assets" / path.relative_to(assets)
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(str(path), str(dest))
    return ["%s:%d: %s" % b for b in sorted(conv.broken, key=lambda b: (b[0], b[1], b[2]))]


def main(argv=None):
    kb_default = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description="Render the KB as GitHub wiki pages.")
    parser.add_argument("--out", required=True, help="output directory (new or empty)")
    parser.add_argument("--kb", default=str(kb_default), help="knowledge base directory")
    parser.add_argument("--repo-root", default=None, help="repo root (default: KB parent)")
    try:
        args = parser.parse_args(argv)
    except SystemExit as exc:
        return 0 if exc.code == 0 else 2
    kb = Path(args.kb)
    root = Path(args.repo_root) if args.repo_root else kb.resolve().parent
    out = Path(args.out)
    if not kb.is_dir():
        print("publish_wiki: KB directory not found: %s" % kb, file=sys.stderr)
        return 2
    if out.exists() and (not out.is_dir() or any(out.iterdir())):
        print("publish_wiki: --out must be a new or empty directory: %s" % out,
              file=sys.stderr)
        return 2
    broken = convert(kb, out, root)
    if broken:
        for line in broken:
            print(line, file=sys.stderr)
        print("%d broken link(s)" % len(broken), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
