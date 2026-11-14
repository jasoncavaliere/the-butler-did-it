# Grocery catalog icons

These six SVG files are the per-category icons for the simulated H-E-B fixture
catalog (`../heb-catalog.json`). Each catalog item has an `iconId` that equals
its `category`, and the icon for an item is the file `<iconId>.svg` in this
folder:

| iconId      | File            |
|-------------|-----------------|
| `produce`   | `produce.svg`   |
| `dairy`     | `dairy.svg`     |
| `pantry`    | `pantry.svg`    |
| `frozen`    | `frozen.svg`    |
| `household` | `household.svg` |
| `kids`      | `kids.svg`      |

Each SVG is embedded in the Butler.Api assembly with the manifest name
`Butler.Api.SeedData.grocery.icons.<iconId>.svg` (see `Butler.Api.csproj`), so
the icons ship with the API and load fully offline. Nothing is fetched from a
remote URL.

## Source

Original artwork created for Butler. The icons were drawn by hand as simple
flat shapes. They are not derived from, traced from, or copied from H-E-B
assets or from any third-party icon set.

## License

CC0 1.0 Universal (public domain dedication):
https://creativecommons.org/publicdomain/zero/1.0/

You may copy, modify, and redistribute these icons for any purpose without
asking permission or giving attribution.
