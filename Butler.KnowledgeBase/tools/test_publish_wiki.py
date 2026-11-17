"""Tests for publish_wiki.py and .github/workflows/kb-wiki.yml (issue #360).

Run from the repo root (stdlib only, no network):

    python3 -m unittest discover Butler.KnowledgeBase/tools

The fixture bundle is written to a temp dir at test time, never committed
under the KB, so agents grepping "^description:" never see fake pages.
"""
import contextlib
import filecmp
import io
import os
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import publish_wiki

TOOLS = Path(__file__).resolve().parent
KB = TOOLS.parent
REPO = TOOLS.parents[1]
SCRIPT = TOOLS / "publish_wiki.py"
WORKFLOW = REPO / ".github" / "workflows" / "kb-wiki.yml"
BLOB = publish_wiki.BLOB_BASE
TREE = publish_wiki.TREE_BASE
PNG = b"\x89PNG\r\n\x1a\n\x00\x01fixture-bytes\xff"

FIXTURE = {
    "Butler.KnowledgeBase/index.md": """---
okf_version: "0.2"
---

# Start Here

* [Doc A](docs/a.md) - The first doc.
* [Doc B](docs/b.md#part) - The second doc.

# More

* [Sub](sub/) - A folder with an index.
* [Decisions](adr/) - A folder with a README.
* [Intake](intake/) - Raw material.
""",
    "Butler.KnowledgeBase/docs/a.md": """---
type: Guide
title: Doc A
description: "The first doc, with a *star* and a comma, here."
related: [b, X-1]
sources:
  - { id: kb-b, resource: b.md#part, title: Doc B, part two, with commas }
  - { id: raw, resource: ../intake/raw.md, title: Raw intake }
  - { id: demo, resource: ../../demo/README.md, title: Demo readme }
  - { id: web, resource: https://example.com/x, title: Example }
  - { id: quoted, resource: "https://example.com/q?a=1&b=%2B", title: Quoted URL }
  - { id: no-resource, title: Just a note }
---

# Doc A heading

Body text links [B](b.md), [B part](b.md#part), [self](#local),
[outside](../../demo/README.md#run), [raw](../intake/raw.md), [tool](../tools/notes.md),
[web](https://example.com/page), [mail](mailto:a@example.com), [rooted](/docs/b.md),
[sub](../sub/index.md), [sub dir](../sub/), [adr dir](../adr/), [notes dir](../notes/),
![diagram](../assets/img/d.png "A diagram").
""",
    "Butler.KnowledgeBase/docs/b.md": """---
type: Guide
title: Doc B
description: Second doc without its own H1.
related: [a]
---

Intro paragraph.

## Part

Back to [A](a.md#doc-a-heading).
""",
    "Butler.KnowledgeBase/docs/code.md": """---
type: Guide
title: Code Samples
---

# Code Samples

Inline `[Title](path)` and ``[x](nowhere.md)`` stay put, but [real](a.md) changes.

```yaml
resource: [y](missing.md)
```

~~~
[z](also-missing.md)
~~~

    [indented](a.md)

Titled [link](b.md "Bee") here.
""",
    "Butler.KnowledgeBase/sub/index.md": """---
type: Index
title: Sub Index
---

# Sub

See [A](../docs/a.md).
""",
    "Butler.KnowledgeBase/adr/README.md": """---
type: Decision Log
title: Decision Log
---

# Decisions

* [X-1](0001-x.md)
""",
    "Butler.KnowledgeBase/adr/0001-x.md": """---
id: X-1
title: The X decision
type: Decision Record
---

# X-1: The X decision
""",
    "Butler.KnowledgeBase/notes/plain.txt": "not markdown\n",
    "Butler.KnowledgeBase/intake/raw.md": "raw [broken](nowhere.md)\n",
    "Butler.KnowledgeBase/tools/notes.md": "tool notes [broken](nowhere.md)\n",
    "demo/README.md": "# Demo\n",
}


def build_fixture(root, extra=None):
    files = dict(FIXTURE)
    files.update(extra or {})
    for rel, text in files.items():
        path = Path(root) / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    png = Path(root) / "Butler.KnowledgeBase/assets/img/d.png"
    png.parent.mkdir(parents=True, exist_ok=True)
    png.write_bytes(PNG)
    return Path(root) / "Butler.KnowledgeBase"


def tree(out):
    return sorted(p.relative_to(out).as_posix() for p in Path(out).rglob("*") if p.is_file())


class FixtureCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name) / "repo"
        self.kb = build_fixture(self.root)
        self.out = Path(self._tmp.name) / "out"
        self.broken = publish_wiki.convert(self.kb, self.out, self.root)

    def tearDown(self):
        self._tmp.cleanup()

    def page(self, name):
        return (self.out / (name + ".md")).read_text(encoding="utf-8")


class ConverterFixtureTests(FixtureCase):
    # AC1
    def test_page_names_home_and_collision_free(self):
        self.assertEqual(self.broken, [])
        pages = [p for p in tree(self.out) if p.endswith(".md")]
        self.assertEqual(pages, sorted([
            "Home.md", "a.md", "b.md", "code.md", "sub-index.md", "README.md",
            "0001-x.md", "_Sidebar.md", "_Footer.md",
        ]))
        lowered = [p.lower() for p in pages]
        self.assertEqual(len(lowered), len(set(lowered)))
        self.assertIn("# Start Here", self.page("Home"))

    def test_collisions_get_deterministic_names(self):
        names = publish_wiki.name_pages(sorted([
            "index.md", "brd/index.md", "x/index.md", "a/Dup.md", "b/dup.md", "home.md",
            "a-Dup.md", "solo.md",
        ]))
        self.assertEqual(names["index.md"], "Home")
        self.assertEqual(names["brd/index.md"], "brd-index")
        self.assertEqual(names["x/index.md"], "x-index")
        self.assertEqual(names["home.md"], "home-2")
        self.assertEqual(names["solo.md"], "solo")
        self.assertEqual(names["a-Dup.md"], "a-Dup")
        self.assertEqual(names["a/Dup.md"], "a-Dup-2")
        self.assertEqual(names["b/dup.md"], "b-dup")
        self.assertEqual(len({n.lower() for n in names.values()}), len(names))

    def test_excludes_intake_tools_and_assets_pages(self):
        files = tree(self.out)
        self.assertNotIn("raw.md", files)
        self.assertNotIn("notes.md", files)
        self.assertFalse(any(f.startswith(("intake/", "tools/")) for f in files))

    # AC2
    def test_kb_links_become_page_names_with_anchor(self):
        a = self.page("a")
        for link in ("[B](b)", "[B part](b#part)", "[rooted](b)", "[sub](sub-index)"):
            self.assertIn(link, a)
        self.assertIn("[A](a#doc-a-heading)", self.page("b"))
        self.assertIn("[A](a)", self.page("sub-index"))
        self.assertIn("[X-1](0001-x)", self.page("README"))
        self.assertNotRegex(a, r"\]\([^)h]*\.md")

    def test_excluded_and_outside_links_use_blob_url(self):
        a = self.page("a")
        self.assertIn("[outside](%sdemo/README.md#run)" % BLOB, a)
        self.assertIn("[raw](%sButler.KnowledgeBase/intake/raw.md)" % BLOB, a)
        self.assertIn("[tool](%sButler.KnowledgeBase/tools/notes.md)" % BLOB, a)
        self.assertIn("[sub dir](sub-index)", a)
        self.assertIn("[adr dir](README)", a)
        self.assertIn("[notes dir](%sButler.KnowledgeBase/notes)" % TREE, a)
        self.assertIn("[Intake](%sButler.KnowledgeBase/intake)" % TREE, self.page("Home"))

    def test_external_and_same_page_links_unchanged(self):
        a = self.page("a")
        self.assertIn("[self](#local)", a)
        self.assertIn("[web](https://example.com/page)", a)
        self.assertIn("[mail](mailto:a@example.com)", a)

    def test_links_in_code_left_alone(self):
        code = self.page("code")
        self.assertIn("`[Title](path)`", code)
        self.assertIn("``[x](nowhere.md)``", code)
        self.assertIn("[real](a)", code)
        self.assertIn("resource: [y](missing.md)", code)
        self.assertIn("[z](also-missing.md)", code)
        self.assertIn("    [indented](a)", code)
        self.assertIn('[link](b "Bee")', code)

    # AC3
    def test_frontmatter_rendered_as_h1_lead_related_sources(self):
        for name in ("a", "b", "code", "Home", "README"):
            self.assertFalse(self.page(name).startswith("---"), name)
            self.assertNotIn("okf_version", self.page(name))
        a = self.page("a")
        self.assertEqual(
            a[:a.index("Body") + 4],
            "# Doc A heading\n\n*The first doc, with a \\*star\\* and a comma, here.*\n\nBody")
        self.assertEqual(a.count("\n# "), 0)
        b = self.page("b")
        self.assertEqual(
            b[:b.index("Intro paragraph.") + 16],
            "# Doc B\n\n*Second doc without its own H1.*\n\nIntro paragraph.")
        self.assertTrue(self.page("code").startswith("# Code Samples\n\nInline"))
        related = a[a.index("**Related**"):a.index("**Sources**")]
        self.assertIn("- [Doc B](b)", related)
        self.assertIn("- [The X decision](0001-x)", related)
        sources = a[a.index("**Sources**"):]
        self.assertIn("- [Doc B, part two, with commas](b#part)", sources)
        self.assertIn("- [Raw intake](%sButler.KnowledgeBase/intake/raw.md)" % BLOB, sources)
        self.assertIn("- [Demo readme](%sdemo/README.md)" % BLOB, sources)
        self.assertIn("- [Example](https://example.com/x)", sources)
        self.assertIn("- [Quoted URL](https://example.com/q?a=1&b=%2B)", sources)
        self.assertIn("- Just a note\n", sources)
        self.assertIn("\n---\n\n**Related**", a)
        self.assertLess(a.index("**Related**"), a.index("**Sources**"))
        self.assertTrue(a.endswith(")\n") or a.endswith("note\n"))
        self.assertIn("- [Doc A](a)", self.page("b"))

    def test_frontmatter_parser_shapes(self):
        fm, lines, body = publish_wiki.parse_page(
            '---\ntitle: "C1: a, b"\nq: \'it\'\'s\'\nrelated: [x, "y, z"]\n'
            "sources:\n  - { id: s, resource: \"https://e.com/?a=1,2\", title: T, with, commas }\n"
            "---\n\nbody\n")
        self.assertEqual(fm["title"], "C1: a, b")
        self.assertEqual(fm["q"], "it's")
        self.assertEqual(fm["related"], ["x", "y, z"])
        self.assertEqual(lines["related"], 4)
        self.assertEqual(fm["sources"], [
            {"id": "s", "resource": "https://e.com/?a=1,2", "title": "T, with, commas"}])
        self.assertEqual(lines["sources"], [6])
        self.assertEqual(body, [(8, ""), (9, "body")])

    # AC4
    def test_sidebar_and_footer_written(self):
        sidebar = self.page("_Sidebar")
        self.assertTrue(sidebar.startswith("[Home](Home)\n"))
        self.assertIn("**Start Here**", sidebar)
        self.assertIn("**More**", sidebar)
        self.assertIn("* [Doc A](a)\n", sidebar)
        self.assertIn("* [Doc B](b#part)\n", sidebar)
        self.assertIn("* [Sub](sub-index)\n", sidebar)
        self.assertIn("* [Decisions](README)\n", sidebar)
        self.assertNotIn("The first doc", sidebar)
        footer = self.page("_Footer")
        self.assertIn("generated from", footer)
        self.assertIn("kb-wiki.yml", footer)
        self.assertIn("overwrites wiki edits", footer)
        self.assertIn("Do not edit it here", footer)
        self.assertIn("(%sButler.KnowledgeBase)" % TREE, footer)
        footer.encode("ascii")

    # AC5
    def test_assets_copied_and_referenced(self):
        copied = self.out / "assets" / "img" / "d.png"
        self.assertTrue(copied.is_file())
        self.assertEqual(copied.read_bytes(), PNG)
        self.assertIn('![diagram](assets/img/d.png "A diagram")', self.page("a"))

    # AC11
    def test_two_runs_byte_identical_fixture(self):
        out2 = Path(self._tmp.name) / "out2"
        publish_wiki.convert(self.kb, out2, self.root)
        assert_same_tree(self, self.out, out2)


class BrokenLinkTests(unittest.TestCase):
    # AC6
    def test_broken_links_exit_nonzero_with_file_line(self):
        extra = {
            "Butler.KnowledgeBase/docs/bad.md": (
                "---\ntype: Guide\ntitle: Bad\nrelated: [a, no-such-page]\nsources:\n"
                "  - { id: ok, resource: a.md, title: OK }\n"
                "  - { id: gone, resource: gone.md, title: Gone }\n"
                "---\n\n# Bad\n\nSee [nothing](nothing.md#x).\n"
                "And [escape](../../../../etc/passwd).\n"
            ),
        }
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "repo"
            kb = build_fixture(root, extra)
            err = io.StringIO()
            with contextlib.redirect_stderr(err):
                code = publish_wiki.main([
                    "--out", str(Path(tmp) / "out"), "--kb", str(kb), "--repo-root", str(root)])
            self.assertEqual(code, 1)
            text = err.getvalue()
            self.assertIn("Butler.KnowledgeBase/docs/bad.md:4: broken link 'no-such-page'", text)
            self.assertIn("Butler.KnowledgeBase/docs/bad.md:7: broken link 'gone.md'", text)
            self.assertIn("Butler.KnowledgeBase/docs/bad.md:12: broken link 'nothing.md#x'", text)
            self.assertIn("Butler.KnowledgeBase/docs/bad.md:13: broken link '../../../../etc/passwd'",
                          text)
            self.assertIn("4 broken link(s)", text)
            self.assertNotIn("intake/raw.md", text)
            self.assertNotIn("tools/notes.md", text)

            proc = subprocess.run(
                [sys.executable, str(SCRIPT), "--out", str(Path(tmp) / "out-cli"),
                 "--kb", str(kb), "--repo-root", str(root)],
                capture_output=True, text=True)
            self.assertEqual(proc.returncode, 1)
            self.assertRegex(proc.stderr, r"docs/bad\.md:12: broken link")

    # #376: a block-style related: list reports the failing item's line, not a TypeError.
    def test_block_related_broken_slug_reports_item_line(self):
        self.assertEqual(
            publish_wiki.parse_page("---\nrelated:\n  - a\n  - nope\n---\n")[1]["related"], [3, 4])
        extra = {
            "Butler.KnowledgeBase/docs/blocky.md": (
                "---\ntype: Guide\ntitle: Blocky\nrelated:\n  - a\n  - nope\n---\n\n# Blocky\n"
            ),
        }
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "repo"
            kb = build_fixture(root, extra)
            out = Path(tmp) / "out"
            err = io.StringIO()
            with contextlib.redirect_stderr(err):
                code = publish_wiki.main([
                    "--out", str(out), "--kb", str(kb), "--repo-root", str(root)])
            self.assertEqual(code, 1)
            text = err.getvalue()
            self.assertIn("Butler.KnowledgeBase/docs/blocky.md:6: broken link 'nope' (related)", text)
            self.assertIn("1 broken link(s)", text)
            self.assertIn("- [Doc A](a)", (out / "blocky.md").read_text())

    def test_non_empty_out_is_usage_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "repo"
            kb = build_fixture(root)
            out = Path(tmp) / "out"
            out.mkdir()
            (out / "stale.md").write_text("x")
            with contextlib.redirect_stderr(io.StringIO()):
                code = publish_wiki.main(["--out", str(out), "--kb", str(kb),
                                          "--repo-root", str(root)])
            self.assertEqual(code, 2)


def assert_same_tree(case, one, two):
    case.assertEqual(tree(one), tree(two))
    for rel in tree(one):
        case.assertTrue(filecmp.cmp(str(Path(one) / rel), str(Path(two) / rel), shallow=False),
                        rel)


class RealKnowledgeBaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._tmp = tempfile.TemporaryDirectory()
        cls.out = Path(cls._tmp.name) / "wiki"
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            cls.code = publish_wiki.main(["--out", str(cls.out)])
        cls.err = err.getvalue()

    @classmethod
    def tearDownClass(cls):
        cls._tmp.cleanup()

    def published(self):
        return [p for p in KB.rglob("*.md")
                if p.relative_to(KB).parts[0] not in ("intake", "tools", "assets")]

    # AC1, AC6
    def test_real_kb_converts_cleanly(self):
        self.assertEqual(self.code, 0, self.err)
        pages = [p for p in tree(self.out)
                 if p.endswith(".md") and p not in ("_Sidebar.md", "_Footer.md")]
        self.assertEqual(len(pages), len(self.published()))
        for name in ("Home.md", "brd-index.md", "README.md"):
            self.assertIn(name, pages)
        self.assertNotIn("index.md", pages)

    # AC2, AC3
    def test_real_kb_links_and_frontmatter(self):
        names = set(tree(self.out))
        link = re.compile(r"\]\(([^)\s]+)")
        for rel in names:
            if not rel.endswith(".md"):
                continue
            text = (self.out / rel).read_text(encoding="utf-8")
            self.assertFalse(text.startswith("---"), rel)
            for target in link.findall(_strip_code(text)):
                if re.match(r"^[a-z]+:", target) or target.startswith("#"):
                    continue
                path = target.split("#")[0]
                self.assertFalse(path.endswith(".md"), "%s -> %s" % (rel, target))
                if not path.startswith("assets/"):
                    self.assertIn(path + ".md", names, "%s -> %s" % (rel, target))

    # AC11
    def test_two_runs_byte_identical_real_kb(self):
        out2 = Path(self._tmp.name) / "wiki2"
        with contextlib.redirect_stderr(io.StringIO()):
            publish_wiki.main(["--out", str(out2)])
        assert_same_tree(self, self.out, out2)


def _strip_code(text):
    out, fence = [], False
    for line in text.split("\n"):
        if re.match(r"^ {0,3}(```|~~~)", line):
            fence = not fence
            continue
        if not fence:
            out.append(publish_wiki.mask_code_spans(line))
    return "\n".join(out)


# ------------------------------------------------------------- workflow


def workflow_jobs(text):
    """Split kb-wiki.yml into {job: block text} with a line scanner (no YAML lib)."""
    jobs, current, in_jobs = {}, None, False
    for line in text.split("\n"):
        if re.match(r"^jobs:\s*$", line):
            in_jobs = True
            continue
        if in_jobs and re.match(r"^\S", line):
            in_jobs = False
            current = None
        if not in_jobs:
            continue
        m = re.match(r"^  ([A-Za-z0-9_-]+):\s*$", line)
        if m:
            current = m.group(1)
            jobs[current] = []
            continue
        if current:
            jobs[current].append(line)
    return {k: "\n".join(v) for k, v in jobs.items()}


def top_level(text):
    """The workflow text before jobs:."""
    return text.split("\njobs:", 1)[0]


def no_comments(text):
    return "\n".join(l for l in text.split("\n") if not l.lstrip().startswith("#"))


class WorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = WORKFLOW.read_text(encoding="utf-8")
        cls.code = no_comments(cls.text)
        cls.jobs = workflow_jobs(cls.code)

    def on_block(self, event):
        m = re.search(r"^  %s:\n((?:    .*\n|      .*\n)*)" % event, self.code, re.M)
        self.assertIsNotNone(m, event)
        return m.group(1)

    # AC7a
    def test_workflow_publish_triggers_and_commit_only_on_change(self):
        push = self.on_block("push")
        self.assertRegex(push, r"branches: \[main\]")
        self.assertIn('"Butler.KnowledgeBase/**"', push)
        self.assertRegex(self.code, r"(?m)^  workflow_dispatch:")
        publish = self.jobs["publish"]
        self.assertRegex(publish, r"needs: check")
        self.assertIn("github.event_name != 'pull_request'", publish)
        self.assertIn("github.ref == 'refs/heads/main'", publish)
        self.assertIn("python3 Butler.KnowledgeBase/tools/publish_wiki.py --out", publish)
        self.assertIn(".wiki.git", publish)
        self.assertIn("git clone", publish)
        self.assertIn("git add -A", publish)
        self.assertIn("git diff --cached --quiet", publish)
        self.assertLess(publish.index("git diff --cached --quiet"), publish.index("git commit"))
        self.assertRegex(publish, r"git push (--quiet )?origin HEAD")
        self.assertNotRegex(publish, r"echo[^\n]*WIKI_URL")

    # AC7b
    def test_workflow_missing_wiki_fails_with_message(self):
        publish = self.jobs["publish"]
        self.assertIn('git ls-remote "$WIKI_URL"', publish)
        guard = publish[publish.index("git ls-remote"):publish.index("git clone")]
        self.assertIn("|| {", guard)
        self.assertIn("exit 1", guard)
        self.assertIn("Create the first wiki page", guard)
        self.assertLess(publish.index("git ls-remote"), publish.index("git clone"))

    # AC8
    def test_workflow_pr_check_runs_tests_without_publishing(self):
        pr = self.on_block("pull_request")
        self.assertIn('"Butler.KnowledgeBase/**"', pr)
        self.assertIn('".github/workflows/kb-wiki.yml"', pr)
        check = self.jobs["check"]
        self.assertNotIn("if:", check)
        self.assertNotIn("needs:", check)
        self.assertIn("python3 -m unittest discover Butler.KnowledgeBase/tools", check)
        self.assertIn("python3 Butler.KnowledgeBase/tools/publish_wiki.py --out", check)
        for word in ("git push", "git clone", "wiki.git", "git commit"):
            self.assertNotIn(word, check)

    # AC12
    def test_workflow_least_privilege(self):
        self.assertRegex(top_level(self.code), r"(?m)^permissions:\n  contents: read\s*$")
        self.assertEqual(set(self.jobs), {"check", "publish"})
        self.assertRegex(self.jobs["check"], r"permissions:\n      contents: read")
        self.assertNotIn("write", self.jobs["check"])
        self.assertRegex(self.jobs["publish"], r"permissions:\n      contents: write")
        self.assertEqual(self.code.count("contents: write"), 1)
        self.assertNotIn(": write", self.code.replace("contents: write", ""))
        self.assertNotIn("secrets.", self.code)
        self.assertNotRegex(self.code, r"(?i)\bPAT\b|personal access")
        tokens = re.findall(r"\$\{\{\s*([^}]*token[^}]*)\}\}", self.code, re.I)
        self.assertEqual([t.strip() for t in tokens], ["github.token"])


if __name__ == "__main__":
    unittest.main()
