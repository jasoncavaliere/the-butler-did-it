# Contributing

Butler is a monorepo of independent sub-services, each with its own toolchain and
its own CI workflow. There is **no root build** - run commands inside the relevant
sub-service folder. See [`CLAUDE.md`](CLAUDE.md) for the full working guide and
[`Butler.KnowledgeBase/brd/`](Butler.KnowledgeBase/brd/) for the v1 spec.

## CI and how to mirror it locally

Every pull request runs the gates below via GitHub Actions. Both workflows are
**path-filtered**, so a PR only triggers the check(s) for the sub-service(s) it
touches:

| Sub-service | Workflow | Triggers on |
| --- | --- | --- |
| `Butler.API/` | [`.github/workflows/api-ci.yml`](.github/workflows/api-ci.yml) | changes under `Butler.API/**` |
| `Butler.UI/` | [`.github/workflows/ui-ci.yml`](.github/workflows/ui-ci.yml) | changes under `Butler.UI/**` |

Run these locally before pushing to reproduce exactly what CI runs.

### Butler.API (.NET 10)

The .NET SDK version is pinned by `Butler.API/global.json`; CI uses the same.

```bash
# from Butler.API/
dotnet restore
dotnet build --configuration Release /p:TreatWarningsAsErrors=true   # warnings fail the build
dotnet test /p:CollectCoverage=true                                  # 98% coverage gate
```

`dotnet test` on its own stays fast (no coverage). The `98`/`line,branch,method`/`total`
threshold values are defaulted in `Butler.Api.Tests.csproj`, so `dotnet test
/p:CollectCoverage=true` enforces exactly what CI enforces - no need to repeat the
threshold flags locally. (CI does pass them explicitly, with the commas URL-escaped
as `%2c` because the `dotnet` CLI otherwise splits an unescaped comma in `/p:` into
separate switches.)

### Butler.UI (Expo, Node LTS)

CI runs on the active Node LTS (currently 22.x). Match it locally if you can.

```bash
# from Butler.UI/
npm ci                          # lockfile-exact install (CI uses this, not `npm install`)
npm run ci:verify               # lint + typecheck + 98% coverage-gated test
npx expo export --platform web  # web bundle (the v1 hub's deploy artifact)
```

`npm run ci:verify` is the single command that mirrors the UI gate; the coverage
threshold lives in `jest.config.js` (`coverageThreshold.global`).

## Coverage gate

Both sub-services enforce the **98% coverage gate** from Engineering Contract 7.7
(lines, branches, and methods/functions). A change that drops any of those below
98% fails CI - keep new code covered.
