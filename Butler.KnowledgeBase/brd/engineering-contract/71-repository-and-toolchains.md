---
type: Contract Clause
title: Engineering Contract 7.1 - Repository and toolchains
description: One repo, two sub-services with independent toolchains, and the exact build, lint, test, and export gates each ticket must name.
tags: [engineering-contract, binding]
contract: ../07-engineering-contract.md
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-13T00:00:00Z }
---

# 7.1 Repository and toolchains

> Part of the binding [Engineering Contract](../07-engineering-contract.md). Read this clause on its own; the other clauses are listed there.

- One git repo: `the-butler-did-it`. Two sub-services with independent toolchains and no root build:
  - `Butler.API/` - .NET 10 Web API (`Butler.API.sln` -> `src/Butler.Api`). Gates: `dotnet build` and `dotnet test`, both with `/p:TreatWarningsAsErrors=true`. The test gate includes the 98 percent coverage threshold (Section 7.7).
  - `Butler.UI/` - Expo 57 / React 19 / react-native-web (web-first). Gates: `npm run lint`, `npm run typecheck` (or `tsc --noEmit`), `npm test`, and `npx expo export --platform web` must succeed. The test gate includes the 98 percent coverage threshold (Section 7.7).
- A ticket names exactly which sub-service(s) it touches and which of the above gates apply. A gate that does not yet exist in a sub-service is a stated fact, never a silent skip (Foundations creates them; see Epic 10).
