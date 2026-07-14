#!/usr/bin/env python3
"""Generate the canonical Ticket <-> GitHub Issue crosswalk (ticket-issue-map.md).

Reads the BRD epic files for ticket metadata (id, title, epic, priority, blocked-by)
and the live GitHub issues (matched by the "ID:" title prefix), then writes
Butler.KnowledgeBase/brd/ticket-issue-map.md.

Re-run any time issues are added, renumbered, or closed:

    python3 Butler.KnowledgeBase/brd/tools/generate_issue_map.py

Requires: `gh` authenticated for the repo. Output is plain ASCII (KB usability scorer).
"""
import re, json, subprocess, pathlib, sys

REPO = "jasoncavaliere/the-butler-did-it"
BRD = pathlib.Path(__file__).resolve().parent.parent          # .../brd
OUT = BRD / "ticket-issue-map.md"

# epic file -> (display name, epic label). Order defines the map + implementation order.
EPICS = [
    ("10-epic-foundations.md",          "Foundations & Delivery Rails", "epic:foundations"),
    ("20-epic-household-model.md",       "Household Model",              "epic:household-model"),
    ("30-epic-tap-to-claim-hub.md",      "Tap-to-Claim & Hub",           "epic:tap-to-claim"),
    ("40-epic-chores-fair-assignment.md","Chores & Fair Assignment",     "epic:chores"),
    ("50-epic-grocery-assisted-cart.md", "Grocery Assisted Cart",        "epic:grocery"),
    ("60-epic-offline-pwa.md",           "Offline PWA",                  "epic:offline"),
]

TICKET_RE   = re.compile(r"^## ([A-Z]+\d+): (.+)$")
BLOCKED_RE  = re.compile(r"^\*\*Blocked by:\*\*\s*(.+)$")
PRIORITY_RE = re.compile(r"priority:(p\d)")

def sh(*args):
    return subprocess.run(args, capture_output=True, text=True, check=True).stdout

def parse_epics():
    tickets = []  # {id,title,epic,epic_file,priority,blocked:[ids]}
    for fname, epic_name, epic_label in EPICS:
        lines = (BRD / fname).read_text().splitlines()
        heads = [i for i, l in enumerate(lines) if TICKET_RE.match(l)]
        for start in heads:
            m = TICKET_RE.match(lines[start])
            tid, ttitle = m.group(1), m.group(2)
            end = next((j for j in range(start + 1, len(lines))
                        if lines[j].strip() == "---" or TICKET_RE.match(lines[j])
                        or lines[j].startswith("## Related")), len(lines))
            block = "\n".join(lines[start + 1:end])
            prio = PRIORITY_RE.search(block)
            blocked = []
            for bl in block.splitlines():
                bm = BLOCKED_RE.match(bl)
                if bm:
                    blocked = re.findall(r"#<([A-Z]+\d+)>", bm.group(1))
                    break
            tickets.append({
                "id": tid, "title": ttitle, "epic": epic_name, "epic_file": fname,
                "priority": prio.group(1) if prio else "-", "blocked": blocked,
            })
    return tickets

def live_issue_index():
    data = json.loads(sh("gh", "issue", "list", "--repo", REPO, "--state", "all",
                         "--limit", "300", "--json", "number,title,state"))
    idx = {}
    for it in data:
        m = re.match(r"^([A-Z]+\d+):", it["title"])
        if m:
            idx[m.group(1)] = {"number": it["number"], "state": it["state"]}
    return idx

def main():
    tickets = parse_epics()
    idx = live_issue_index()
    covered = {t["id"] for t in tickets}
    # standalone "ID:"-titled issues not in any epic file (e.g. DOC1)
    extras = sorted((tid for tid in idx if tid not in covered),
                    key=lambda x: (x[0], int(re.search(r"\d+", x).group())))

    def link(tid):
        info = idx.get(tid)
        if not info:
            return "(unfiled)"
        s = "" if info["state"] == "OPEN" else " (closed)"
        return f"#{info['number']}{s}"

    L = []
    L.append("---")
    L.append("name:          brd-ticket-issue-map")
    L.append("title:         Ticket to GitHub Issue Map (canonical crosswalk)")
    L.append("category:      Product & Strategy")
    L.append("lifecycle:     Living")
    L.append("owner:         product")
    L.append("generated-by:  brd/tools/generate_issue_map.py")
    L.append("---")
    L.append("")
    L.append("# Butler v1 - Ticket to GitHub Issue Map")
    L.append("")
    L.append("> **Canonical crosswalk.** This is the single source that bridges the BRD ticket IDs "
             "(F1, H1, ...), their epic-file specs, and the live GitHub issues. Future Claude sessions "
             "and team members reference this to translate between the planning docs and the tracker.")
    L.append("")
    L.append(f"- **Repo:** `{REPO}`  -  **Issues:** https://github.com/{REPO}/issues")
    L.append("- **This file is generated.** Do not hand-edit the table. Re-run "
             "`python3 Butler.KnowledgeBase/brd/tools/generate_issue_map.py` after filing, "
             "renumbering, or closing issues.")
    L.append("")
    L.append("## Conventions (how the three layers line up)")
    L.append("")
    L.append("- **Ticket ID** (`F1`, `H3`, `C2`, ...) is the stable planning handle. Letter = epic "
             "(F=Foundations, H=Household, T=Tap-to-Claim, C=Chores, G=Grocery, O=Offline); the "
             "number orders within the epic.")
    L.append("- **Epic file** under `Butler.KnowledgeBase/brd/` holds the full spec (Summary, Context, "
             "Acceptance Criteria, Testing, Risks).")
    L.append("- **GitHub issue** title is `\"<ID>: <title>\"`, so the ID is always recoverable from the "
             "tracker: `gh issue list --search \"F1 in:title\"`.")
    L.append("- **Blocked by** is captured as GitHub `#` cross-references in each issue body; the "
             "epic-file specs use `#<ID>` placeholders that this generator resolves to live numbers.")
    L.append("- **Labels** classify each issue: `epic:*`, `area:*` (api / ui / infra / docs), `type:*`, "
             "`priority:*`. The `/implement-issue` workflow adds its own `status:*` labels on top.")
    L.append("")
    L.append("## Crosswalk")
    L.append("")
    L.append("| Ticket | GitHub | Priority | Epic | Blocked by | Title |")
    L.append("| --- | --- | --- | --- | --- | --- |")
    for t in tickets:
        blocked = ", ".join(f"{b} {link(b)}" for b in t["blocked"]) or "-"
        title = t["title"].replace("|", "\\|")
        L.append(f"| **{t['id']}** | {link(t['id'])} | {t['priority']} | "
                 f"[{t['epic']}]({t['epic_file']}) | {blocked} | {title} |")
    for tid in extras:
        info = idx[tid]
        ttl = sh("gh", "issue", "view", str(info["number"]), "--repo", REPO,
                 "--json", "title", "-q", ".title").strip()
        ttl = re.sub(r"^[A-Z]+\d+:\s*", "", ttl).replace("|", "\\|")
        L.append(f"| **{tid}** | {link(tid)} | - | (cross-cutting / docs) | - | {ttl} |")
    L.append("")
    L.append(f"**Totals:** {len(tickets)} epic tickets"
             + (f" + {len(extras)} cross-cutting" if extras else "")
             + f" = {len(tickets) + len(extras)} issues.")
    L.append("")
    L.append("## Implementation order")
    L.append("")
    L.append("Follow the dependency order in [README.md](README.md): Foundations first, then Household "
             "Model, then Tap-to-Claim and Grocery, then Chores, then Offline. Each issue's `Blocked by` "
             "column above lists the issues that must land first. Start an issue with "
             "`/implement-issue <number>` and land it with `/merge-issue <number>`.")
    L.append("")
    L.append("## Related")
    L.append("")
    L.append("- [00-brd-master.md](00-brd-master.md) - the requirements and Engineering Contract.")
    L.append("- [README.md](README.md) - epic index, label taxonomy, dependency graph, filing recipe.")
    L.append("")

    OUT.write_text("\n".join(L))
    print(f"Wrote {OUT} ({len(tickets)} tickets, {len(extras)} cross-cutting).")

if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as e:
        sys.exit(f"gh call failed: {e.stderr}")
