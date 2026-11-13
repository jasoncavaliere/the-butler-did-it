---
type: Ticket
title: "G3: Capture seam (`ICaptureSource`) + add-to-cart via text and simulated voice"
description: ICaptureSource seam that turns a typed or simulated spoken utterance into an item in the building cart.
resource: https://github.com/jasoncavaliere/the-butler-did-it/issues/28
tags: [epic:grocery, area:api, type:feature, priority:p0]
epic: ../50-epic-grocery-assisted-cart.md
blocked-by: [G1, G2]
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-13T00:00:00Z }
---

# G3: Capture seam (`ICaptureSource`) + add-to-cart via text and simulated voice

**Sub-service(s):** `Butler.API/`
**Blocked by:** G1 (`#<G1>`), G2 (`#<G2>`)
**Serves:** FR-5, BO-3

## Summary
Turn a spoken or typed utterance ("add oat milk") into a cart item: an `ICaptureSource` seam resolves the utterance to a product via the G1 connector and adds it to the current building cart. v1 ships a hub text-capture implementation and a simulated voice-capture implementation behind the same seam.

## Context
Implements decision [D-5](../00-brd-master.md#53-scope-decisions-that-resolve-would-be-material-assumptions): the capture seam ships in v1; live Alexa is deferred behind it (Section 9 fast-follow) and is explicitly out of scope here. Both v1 sources reduce to the same operation - resolve text -> product -> add to the building cart - so the seam is a thin normalizer over a shared handler, not two code paths. The active participant/hub identity supplies `AddedByPersonId` (tap-to-claim, [D-3](../00-brd-master.md#53-scope-decisions-that-resolve-would-be-material-assumptions)); capture is not an organizer-only action.

## Acceptance Criteria
- [ ] An `ICaptureSource` seam accepts a free-text utterance (for example `"add oat milk"`), extracts the product term, resolves it via `IStoreConnector.SearchProducts`, and adds the top match to the household's current building cart with `Quantity` defaulting to `1` and `AddedByPersonId` from the active participant/hub session.
- [ ] Added items carry the `SourceConnector` from the resolved product (G1).
- [ ] A hub text-capture implementation and a simulated voice-capture implementation both exist behind `ICaptureSource` and share the same resolve-and-add handler.
- [ ] Ambiguous or no-match input returns a clear, structured result - suggestions (candidate products) or a `404`/`400`-style problem detail - and never throws an unhandled exception.
- [ ] Live Alexa is explicitly out of scope for this ticket (stated in the issue); only the two simulated/hub sources ship.
- [ ] The feature registers via its `Add<Feature>Feature()` extension and adds to the building cart from G2 (get-or-create), respecting cart optimistic concurrency.
- [ ] Builds clean with `TreatWarningsAsErrors`; `dotnet test` green.

## Testing
- Gates: `cd Butler.API && dotnet build ... /p:TreatWarningsAsErrors=true && dotnet test`.
- Add tests: `TextCaptureTests` (a matching utterance adds the expected item to the building cart), `SimulatedVoiceCaptureTests` (the voice source resolves and adds through the same handler), and `AmbiguousCaptureTests` (no-match / ambiguous input returns suggestions or a problem detail, no exception).

## Risks & Rollback
- R: naive term extraction mis-parses utterances. Mitigation: v1 uses a simple, documented normalization (strip a leading "add", trim) and returns suggestions on low confidence rather than guessing silently. Rollback = revert; G2 and the connector remain intact.
