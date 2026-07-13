# the-butler-did-it

**Butler** - a household concierge. A shared family operating system: a kitchen-tablet hub that fairly
divides household work, models the home, and reaches into the real world to get things done (starting
with groceries). Also a tech experiment and a #buildinpublic series, shipped in the open one capability
at a time.

Start with the **[Product Vision](Butler.KnowledgeBase/docs/10-product-vision.md)**.

## Monorepo layout

| Folder | What | Stack |
| --- | --- | --- |
| [`Butler.UI/`](Butler.UI/) | The hub front end | Expo (React Native + web), web-first -> Azure Static Web App, Bicep |
| [`Butler.API/`](Butler.API/) | The backend service | .NET 9 Web API -> Azure App Service, Bicep |
| [`Butler.KnowledgeBase/`](Butler.KnowledgeBase/) | Agent-managed wiki (canonical Markdown) | see its [README](Butler.KnowledgeBase/README.md) |

Each sub-service is independent (its own build, deploy, and `infra/`). See [`CLAUDE.md`](CLAUDE.md) for
how to work in this repo.
