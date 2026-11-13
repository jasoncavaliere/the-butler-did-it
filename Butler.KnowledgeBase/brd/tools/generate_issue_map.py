#!/usr/bin/env python3
"""Generate the canonical Ticket <-> GitHub Issue crosswalk (ticket-issue-map.md).

Reads the ticket files (brd/tickets/*.md frontmatter: title, epic, tags, blocked-by)
and the live GitHub issues (matched by the "ID:" title prefix), then writes
Butler.KnowledgeBase/brd/ticket-issue-map.md.

Re-run any time issues are added, renumbered, or closed:

    python3 Butler.KnowledgeBase/brd/tools/generate_issue_map.py

Requires: `gh` authenticated for the repo. Output is plain ASCII (KB usability scorer).
"""
import re, json, subprocess, pathlib, sys
from datetime import datetime, timezone

REPO = "jasoncavaliere/the-butler-did-it"
BRD = pathlib.Path(__file__).resolve().parent.parent          # .../brd
OUT = BRD / "ticket-issue-map.md"
TICKETS = BRD / "tickets"

# epic file -> (display name, epic label). Order defines the map + implementation order.
EPICS = [
    ("10-epic-foundations.md",          "Foundations & Delivery Rails", "epic:foundations"),
    ("20-epic-household-model.md",       "Household Model",              "epic:household-model"),
    ("30-epic-tap-to-claim-hub.md",      "Tap-to-Claim & Hub",           "epic:tap-to-claim"),
    ("40-epic-chores-fair-assignment.md","Chores & Fair Assignment",     "epic:chores"),
    ("50-epic-grocery-assisted-cart.md", "Grocery Assisted Cart",        "epic:grocery"),
    ("60-epic-offline-pwa.md",           "Offline PWA",                  "epic:offline"),
]

FM_RE = re.compile(r"^---\n(.*?)\n---\n", re.S)

def sh(*args):
    return subprocess.run(args, capture_output=True, text=True, check=True).stdout

def frontmatter(path):
    fm = {}
    m = FM_RE.match(path.read_text())
    for line in (m.group(1).splitlines() if m else []):
        if ":" in line and not line.startswith(" "):
            k, _, v = line.partition(":")
            v = v.strip()
            if v.startswith("[") and v.endswith("]"):
                v = [s.strip() for s in v[1:-1].split(",") if s.strip()]
            elif v.startswith('"') and v.endswith('"'):
                v = json.loads(v)
            fm[k.strip()] = v
    return fm

def parse_tickets():
    """One ticket per file under brd/tickets/, ordered by epic (EPICS order) then ticket number."""
    order = {fname: i for i, (fname, _, _) in enumerate(EPICS)}
    names = {fname: name for fname, name, _ in EPICS}
    tickets = []
    for f in sorted(TICKETS.glob("*.md")):
        fm = frontmatter(f)
        tid, _, title = fm["title"].partition(": ")
        epic_file = fm["epic"].split("/")[-1]
        prio = next((t.split(":")[1] for t in fm.get("tags", []) if t.startswith("priority:")), "-")
        tickets.append({
            "id": tid, "title": title, "file": f"tickets/{f.name}",
            "epic": names[epic_file], "epic_file": epic_file,
            "priority": prio, "blocked": fm.get("blocked-by", []) or [],
        })
    tickets.sort(key=lambda t: (order[t["epic_file"]], int(re.search(r"\d+", t["id"]).group())))
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
    tickets = parse_tickets()
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
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    L.append("---")
    L.append("type: Crosswalk")
    L.append("title: Ticket to GitHub Issue Map (canonical crosswalk)")
    L.append("description: Generated map from each v1 ticket ID to its ticket file, epic, priority, blockers, and GitHub issue number.")
    L.append("tags: [brd, tickets, github-issues, crosswalk]")
    L.append("owner: product")
    L.append(f"resource: https://github.com/{REPO}/issues")
    L.append(f"generated: {{ by: process:generate_issue_map, at: {now} }}")
    L.append("---")
    L.append("")
    L.append("# Butler v1 - Ticket to GitHub Issue Map")
    L.append("")
    L.append("> **Canonical crosswalk.** This is the single source that bridges the BRD ticket IDs "
             "(F1, H1, ...), their ticket files, and the live GitHub issues. Future Claude sessions "
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
    L.append("- **Ticket file** `Butler.KnowledgeBase/brd/tickets/<ID>-<slug>.md` holds the full spec (Summary, "
             "Context, Acceptance Criteria, Testing, Risks); its epic file lists it.")
    L.append("- **GitHub issue** title is `\"<ID>: <title>\"`, so the ID is always recoverable from the "
             "tracker: `gh issue list --search \"F1 in:title\"`.")
    L.append("- **Blocked by** is captured as GitHub `#` cross-references in each issue body; the "
             "ticket files use `#<ID>` placeholders that this generator resolves to live numbers.")
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
        L.append(f"| [**{t['id']}**]({t['file']}) | {link(t['id'])} | {t['priority']} | "
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
    L.append("Follow the dependency order in [filing-guide.md](filing-guide.md): Foundations first, then Household "
             "Model, then Tap-to-Claim and Grocery, then Chores, then Offline. Each issue's `Blocked by` "
             "column above lists the issues that must land first. Start an issue with "
             "`/implement-issue <number>` and land it with `/merge-issue <number>`.")
    L.append("")
    L.append("## Related")
    L.append("")
    L.append("- [00-brd-master.md](00-brd-master.md) - the requirements; [07-engineering-contract.md](07-engineering-contract.md) - the binding Engineering Contract.")
    L.append("- [index.md](index.md) - the BRD map; [filing-guide.md](filing-guide.md) - label taxonomy, dependency order, filing recipe.")
    L.append("")

    OUT.write_text("\n".join(L))
    print(f"Wrote {OUT} ({len(tickets)} tickets, {len(extras)} cross-cutting).")

if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as e:
        sys.exit(f"gh call failed: {e.stderr}")
