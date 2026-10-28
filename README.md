# ms-front-kit

Macmillan Studio's personal frontend toolkit. Generates project-owned code.

Repository: https://github.com/cmacmillanmarin/ms-front-kit

No package registry publication is configured.

## Requirements and setup

Node.js 22 or newer (use a current supported release for Nuxt).

```sh
npm ci
npm test
npm link
```

Alternatively, run `node /absolute/path/to/ms-front-kit/src/cli/index.js ...`
without installing a global command.

## Use the kit in a project

The kit adds files to an **existing** Nuxt or Vue project; it does not create the
application itself. Install/link the CLI from the toolkit directory as described
above, then run all commands below from the consuming project's root (where its
package.json lives). The project does not need the toolkit as an npm dependency.

### 1. Initialize once

For a Nuxt 4 project using the default app/ layout:

```sh
cd "/path/to/your-nuxt-project"
ms-front-kit init --framework nuxt
```

For a plain Vue project:

```sh
cd "/path/to/your-vue-project"
ms-front-kit init --framework vue
```

Choose one framework, not both. Nuxt init installs GSAP and creates its client
plugin; Vue init creates only the configuration. Before continuing, review
ms-front-kit.json and adjust paths for your project. For example, Nuxt defaults
to app/components, app/composables, and app/assets/scss; Vue defaults to their
src/ equivalents. Do not rerun init to change paths: edit the configuration.

### 2. Add the foundation and AI conventions

```sh
npm install --save-dev sass
ms-front-kit add styles
ms-front-kit add conventions
```

The style installer copies the foundation into
`<configured styles directory>/ms-front-kit/`, copies the example font into
public/assets/font/, and registers the stylesheet once. It preserves existing
style entries. Review font licensing before deploying or sharing the example.

The conventions command creates docs/conventions/ms-front-kit.md and creates
AGENTS.md if absent. If AGENTS.md already exists, add the printed reference
manually; the command leaves the existing document unchanged. AGENTS.md stays
shareable and is never excluded by the kit. Only the personal conventions document
is excluded locally through Git's info/exclude, without adding shared .gitignore
rules. Git must be initialized before running add conventions. Neither command
silently upgrades customized files.

### 3. Generate only what you need

```sh
ms-front-kit add component Home/Hero/BackButton
ms-front-kit add composable useDevice
```

For Nuxt defaults, this creates:

```text
app/
  components/Home/Hero/BackButton.vue
  composables/useDevice.ts
  composables/useResize.ts
```

useDevice installs its useResize dependency automatically. In default Nuxt,
render the component as `<HomeHeroBackButton />` and call the composables inside
script setup; their files are auto-imported. Verify auto-import settings if your
project customizes them. Generating a component does not insert it into a page.

In Vue, import the files explicitly. For example, from src/App.vue:

```vue
<script setup lang="ts">
import BackButton from "./components/Home/Hero/BackButton.vue";
import useDevice from "./composables/useDevice";

const { canHover } = useDevice();
</script>

<template>
  <BackButton />
  <p>Hover available: {{ canHover }}</p>
</template>
```

Import the CSS-free Sass tools inside Vue/Nuxt component styles when needed.
The shared component template includes `// @use "abstracts" as *;` as a reminder:

```scss
@use "abstracts" as *;

.home__hero__back-button {
  @include type(body);
  @include font-size(20px);
  padding: rem(24px);
}
```

`add styles` configures a Vite `resolve.alias.abstracts` entry for the installed
abstracts directory, under `vite` in Nuxt config or in Vue's root Vite config.
The import can then be uncommented when needed. For manual installation, add
that alias explicitly. Do not import the global main.scss from every component.

### 4. Customize, run, and commit

Edit generated files normally: they belong to the project. Customize the copied
SCSS tokens, typography, and optional font usage. Run the project's existing dev
and build scripts (commonly npm run dev and npm run build), then commit the
configuration, generated files, application setup edits, and package/lockfile
changes with the project, including AGENTS.md if created. Personal conventions
are locally excluded; do not force-add that document. AI-created components should omit unused commented
examples; the CLI includes those only as scaffolding reminders.

### Running commands again

| Command | Existing-file behavior |
| --- | --- |
| init | Refuses existing config/plugin files; not an update command. |
| add component | Refuses an existing component; use a new name or edit it manually. |
| add composable | Skips existing files and dependencies with a message. |
| add styles | Skips identical files and avoids duplicate entries; differing styles/fonts stop installation before edits. Creates a dev grid helper and app mount, preserving existing helpers and mounts. |
| add conventions | Leaves matching output alone; differing conventions require manual comparison; existing AGENTS.md is preserved. |

Updating the toolkit changes future generation, not existing project code. To
adopt newer templates, compare and merge deliberately; do not delete customized
files just to make a generator run.

## Initialization details

`ms-front-kit.json` is personal tooling configuration. Init automatically adds
its project-scoped path to Git's local `info/exclude`, including in nested
projects and linked worktrees, without changing the shared `.gitignore`.
Existing exclusion rules are preserved and the rule is not duplicated.
Generated application files remain eligible for commits. If Git is unavailable,
init still creates the config but warns that it has not been excluded; add the
local exclusion after initializing Git. Exclusions do not untrack files already
committed to Git; the kit never removes tracked files from the index.

Nuxt initialization now creates both `ms-front-kit.json` and
`app/plugins/ms-front-kit.client.ts`, then runs `npm install gsap`. This updates
the consuming project's package.json and npm lockfile. The client plugin prints
the studio credit, registers CustomEase, and defines the example `ms-ease` easing.
It sets GSAP defaults to duration 0.8 seconds and ease "ms-ease"; individual
tweens can override these.

The plugin includes a fully commented native Font Loading API example, with
success/fallback callbacks, a missing-font check, and a three-second timeout.
Enable it only after installing matching font styles/assets. It does not block
application startup and does not add webfontloader or project-specific stores.

Use `ms-front-kit init --framework nuxt --no-install` to create files without
running npm; install gsap with your chosen package manager afterward. Automatic
installation is npm-only and refuses conflicting package-manager configuration.
Existing init config/plugin files are preserved; init is not an upgrade command.
If npm installation fails, the generated files remain and the error explains how
to retry. Nuxt init statically parses `nuxt.config.ts`, `.js`, or `.mjs` without
executing it. Literal `srcDir` values (including `"app"`, `"src/"`, or `"."`)
set the component/composable source root; literal `dir.assets` and `dir.plugins`
set the SCSS and plugin directories relative to that source root. Without these
settings, it uses Nuxt 4's `app/` defaults. Paths must remain inside the project.
Dynamic layout expressions, spreads/computed keys at the config or dir level,
layered/environment-specific layouts, and multiple config files require manual
setup and are rejected before files are created. Unrelated nested settings and
comments do not affect detection. Custom component scanning or composable import
settings still need review; init does not change Nuxt configuration.

Use `--framework vue` for a plain Vue project (config-only, no Nuxt plugin or GSAP install). Nuxt defaults to `app/` and Vue to
`src/`; inspect `ms-front-kit.json` and adjust paths for the actual project.
The CLI reads configuration from the current directory, not parent directories.
Install `sass` as a development dependency in projects using generated SCSS.

## Project conventions and AI instructions

`ms-front-kit add conventions` reads the current project's configuration and
creates `docs/conventions/ms-front-kit.md`. If no `AGENTS.md` exists, it creates
one with a conditional local-conventions reference. If one already exists, it
preserves it exactly and prints the block for you to add manually (or to replace
an older mandatory reference). An identical optional block is not duplicated.

AGENTS.md should be tracked and shared. The generated block explicitly requires
agents to check for the local document and **read and follow it when present**.
If absent, agents continue normally without creating or fetching it. Only the
file's presence is optional, not compliance when it is available. Shared project
requirements take precedence over conflicting personal conventions. Requirements
for every contributor belong in shared, tracked instructions instead.

Only docs/conventions/ms-front-kit.md is excluded, using Git's local info/exclude
(normally .git/info/exclude). The command asks Git for the correct location,
including linked worktrees, and scopes the rule to the project if it is inside a
larger repository. Git must already be initialized. Existing exclusion rules are
preserved and repeated runs do not duplicate the entry. No new .gitignore rules
are added. Legacy rules under the kit's exact old .gitignore heading are removed;
unrelated rules stay intact. Existing rules elsewhere that still ignore AGENTS.md
are reported for manual review, not silently overridden.

If the personal document is already tracked, the command warns: local exclusions
do not untrack it, and the command never removes tracked files. Review that
situation manually. AI tool support for AGENTS.md varies; an explicit instruction
improves discoverability but cannot guarantee every tool will honor it.

Repeated runs leave identical documents unchanged. If conventions differ because
you customized them or updated the toolkit, they are preserved and a manual
comparison is suggested; local exclusion setup still completes. Existing
AGENTS.md content is never migrated automatically. No automatic conventions
update command is implemented.

The component example is rendered from the actual component template, so future
installations reflect template changes. Review the surrounding conventions prose
when changing generator behavior. `AGENTS.md` in this toolkit instructs AI
contributors to update affected templates, documentation, schema, and tests in
the same change. It guides supported agents, but is not enforcement on its own.
Run `npm test` to check generation and convention alignment.

## SCSS foundation

Run `ms-front-kit add styles` to copy `templates/shared/scss/` into the configured
styles directory under `ms-front-kit/` and register its entry before existing
styles. The configured styles path remains the parent directory. Nuxt setup adds the entry to an existing
literal `css` array (or adds the property if absent), preserving other entries and
comments. Vue setup adds a side-effect import to `src/main.ts` or `src/main.js`.
Repeated runs do not duplicate entries. Identical SCSS files are left alone;
customized files stop installation before any files are copied or config edited.

Automatic Nuxt setup supports a direct `export default defineNuxtConfig({...})`
in exactly one root `nuxt.config.ts`, `.js`, or `.mjs`. Dynamic CSS expressions,
config spreads/computed keys, and ambiguous Vue entries require manual setup.
Linked target paths are refused. Configuration editing preserves existing source
rather than reformatting the whole file. Sass is not installed automatically;
the command prints `npm install --save-dev sass` when needed.

The command also installs a development grid overlay; see below. You can also
copy the foundation and register it manually as described below.
`add conventions` alone does not copy or activate styles.

```text
main.scss                   global entry, include once
abstracts/_index.scss       CSS-free public Sass tools
abstracts/_settings.scss    single $design-root-size declaration
abstracts/_variables.scss   editable fonts, breakpoint and typography maps
abstracts/_functions.scss   rem() conversion from px design values
abstracts/_mixins.scss      font-size(), from(), type(), with token validation
base/_reset.scss            minimal normalization, native focus/controls preserved
base/_tokens.scss           runtime CSS custom properties
base/_fonts.scss            example font registration used by typography tokens
base/_typography.scss       body defaults, browser root size preserved
base/_device.scss           body::after CSS/JS breakpoint bridge
```

In Nuxt, merge `css: ["@/assets/scss/ms-front-kit/main.scss"]` into `nuxt.config.ts`
(adjust for your directory). In Vite Vue, import `"./assets/scss/ms-front-kit/main.scss"` once
from `src/main.ts` for the default `src/assets/scss` layout. Install `sass` as a
dev dependency in the consuming project.

Components import only `abstracts`, using `@use "abstracts" as *;` and calling
helpers without a namespace. `add styles` configures a portable Vite alias using
`fileURLToPath(new URL("./<styles>/ms-front-kit/abstracts", import.meta.url))`.
Vue setup edits a root `vite.config.ts`, `.js`, `.mts`, or `.mjs`, or creates
`vite.config.ts` if absent. Nuxt setup merges `vite.resolve.alias` in its config.
Existing plugins, aliases, and comments are preserved; repeat runs do not add
duplicate entries. Dynamic objects, array-form aliases, CommonJS Vite configs,
and conflicting abstracts aliases stop installation before any changes; merge
manually for those layouts. No new toolkit configuration option is required.
Nuxt setup reuses its built-in `@` alias without adding configuration. It assumes
Nuxt 4's default app/ source directory or honors an explicit literal srcDir.
Styles outside that source directory use the built-in `@@` root alias. Dynamic
srcDir expressions require manual setup. In Vue, an `@` alias is not guaranteed;
use the installed `abstracts` alias or configure it explicitly for manual setup.
Use `@include type(body)` and `@include from(tablet)` as needed. Do not
import `main.scss` in components. No CSS, font faces, or reset is emitted simply
by importing `abstracts`.

Keep the root font size at the browser default. Body starts at 1rem / 1.5;
h1 and h2 have editable example sizes of 48px and 32px, emitted as 3rem and 2rem.
Typography tokens are `h1`, `h2`, `body` (16px), and `small` (14px).
AI-generated components must reuse existing Sass mixins and functions whenever
applicable rather than hand-writing equivalent typography, breakpoints, grid
rules, or conversions. Write design sizes in px: `@include font-size(24px)` emits
1.5rem. Always use `rem()` for lengths that should scale with accessible text
sizing, including padding, margins, and gaps around text: `padding: rem(24px)`.
Use `rem()` for length-based line-height and letter-spacing too, unless a mixin
already converts them. Preserve unitless line-height and zero, and meaningful
percentage/intrinsic/viewport sizing; fixed decorative hairlines may remain px.
Avoid fixed heights that clip enlarged text. Keep the browser root size unchanged.
Typography-map font sizes
are written in px and converted by type(). Root CSS tokens contain example
`--color-primary`, `--color-secondary`, and layout settings, not font settings.
The layout maximum is rem(1920px), or 120rem at the default design reference. Each type
token includes its own family, size, and line height directly, without shared
font defaults. All example tokens use ("Helvetica Now Display", sans-serif);
change each token's family independently. The type() mixin converts any remaining raw px
font-size, line-height, and letter-spacing values while preserving unitless ratios.

The kit's default breakpoints are tablet 561px, tablet-landscape
769px, desktop 1024px, desktop-medium 1280px, desktop-large 1441px, and
desktop-x-large 1800px. from() uses the same conversion to emit rem queries.
$design-root-size is declared only in abstracts/_settings.scss and defaults to
16px. Functions and the body design-size token share that setting. It is a design
conversion reference, not a root CSS font-size setting. Media-query rem units use the browser's initial font size.
Edit the project-owned variables file for consistent values across Vue style compilations.
The example font is registered and explicitly selected by each typography token. Branding, grid classes, and project-specific
helpers are not included.

### Installed example font

`add styles` copies `templates/shared/fonts/HelveticaNowDisplayMedium.woff2` into
`public/assets/font/HelveticaNowDisplayMedium.woff2` and registers it in
`ms-front-kit/base/_fonts.scss`. The body, h1, h2, and small typography tokens
each select that family with a sans-serif fallback.
Confirm licensing before using or sharing it; including it here does not grant
redistribution rights. Identical font files are preserved on repeat runs, and
a different font at the destination stops installation before any edits.
Automatic copying assumes the standard public/ directory; custom public paths
require manual adaptation.

The example uses family
"Helvetica Now Display", weight 500, normal style, WOFF2, and font-display: swap.
Use `/assets/font/HelveticaNowDisplayMedium.woff2` as the URL for a root-hosted
project; adjust for a subpath or CDN. Apply the family with fallbacks and the
matching weight. Edit font-family in each typography token as needed, and set
font weights deliberately to match available faces. Full steps are in the conventions template.

The dedicated folder avoids file conflicts, not global CSS conflicts. Review
reset and typography when adding to an existing foundation. Customize the copied
main.scss to select modules. Alternatively, remove the direct app stylesheet
entry and compose it from your project main.scss with `@use "./ms-front-kit/main";`
before project overrides. Never load both ways. Customized kit files are still
protected on repeat installs; this is not an automatic update mechanism.

The generated conventions document includes both Nuxt and Vue setup instructions,
Sass usage, and customization guidance. Sass compilation tests run with `npm test`.

## First-version scope

- Vue and Nuxt share the Vue basic component template.
- PascalCase directories and filenames, path-prefixed BEM-style root classes,
  TypeScript setup scripts, unscoped SCSS, and an empty wrapper div.
  Add slots manually only when needed. The script includes commented examples
  for typed props with reactive destructuring and native defaults (Vue 3.5+),
  typed emits with zero/one/multiple parameters,
  and Vue 3 lifecycle hooks (onBeforeMount,
  onMounted, onBeforeUnmount), with a commented import for plain Vue.
- `ms-front-kit add component Home/Hero/BackButton` creates
  `<configured component root>/Home/Hero/BackButton.vue` with first wrapper class
  `home__hero__back-button`. The component root itself is excluded from the class.
- Keep global SCSS selectors under the full component namespace: path prefixes
  reduce collisions, but are not a guarantee against all CSS collisions.
- Existing files are never overwritten. Generated code belongs to its project.
- Grid styles are installed as part of the SCSS foundation, not separately.
- Available composables: useResize and useDevice. Flex grid mixins are included.
  Layout component templates, React, and Astro are not implemented.
- No installed-composable inventory or automatic source updates.

Edit `templates/vue/components/basic/component.vue.tpl` to refine the default.
Generated components intentionally have no empty elements or modifiers: add them
as needed using `block__element` and `block--modifier`.

## Development grid overlay

`add styles` creates `<configured components directory>/Helper/Grid.vue`, based
on the Pentsalariok grid helper, and mounts it in the application shell:

- **Nuxt:** `<srcDir>/app.vue` (`app/app.vue` by default), guarded by
  `import.meta.dev`.
- **Vue/Vite:** `src/App.vue`, guarded by `import.meta.env.DEV`.

It uses an explicit relative import, so a custom component directory does not
require Nuxt auto-import configuration. Existing script/template/style content
is preserved. A missing app shell is created (NuxtLayout/NuxtPage for Nuxt, an
empty wrapper for Vue). Existing Helper/Grid.vue files and existing grid mounts
are never overwritten or duplicated. Complex/external app templates or scripts
that cannot be safely merged are left untouched and the CLI prints a manual
mount snippet instead. Dynamic/layered Nuxt source layouts need manual mounting.

The small toggle button shows/hides the overlay and remembers visibility in
localStorage under `helper-grid-visible`. Disabled storage does not break the
toggle. Storage is read only after mount to keep SSR/hydration safe. The button
has an accessible label and pressed state; the visual overlay ignores pointer
input and is hidden from assistive technology. Neither is rendered in production
by the generated development-only mount.

The overlay uses `@use "abstracts" as *;`, `grid()`, and `columns(1)` with the
installed layout tokens. It supplies 12 spans; the default four-column layout
clips extra rows, and the desktop layout shows all 12 columns. Adapt the helper
if the project changes the grid beyond those defaults. It does not require
useResize or useDevice. The generated helper belongs to the project; customize
it normally. `styles.grid` remains an installation marker for the SCSS grid,
not a runtime toggle for the helper.

For manual installation, copy
`templates/vue/components/helper/Grid.vue.tpl` to your components directory as
`Helper/Grid.vue` (without `.tpl`), configure the abstracts alias, then merge:

```vue
<script setup lang="ts">
import MsFrontKitGrid from "./components/Helper/Grid.vue";
const msFrontKitDev = import.meta.dev; // Nuxt; use import.meta.env.DEV in Vue/Vite
</script>

<template>
  <!-- Keep the existing application content. -->
  <MsFrontKitGrid v-if="msFrontKitDev" />
</template>
```

Adjust the import relative to the app shell. Merge into existing blocks rather
than adding duplicate script setup or template blocks. Keep the development
guard when relocating the helper to another layout.

## Flex grid foundation

`add styles` also copies abstracts/_grid.scss and exposes grid(), columns(), and
gap() through abstracts. It sets styles.grid to true after successful setup.
Init leaves that marker false until styles are installed. Existing installations
with differing files still require a deliberate manual merge, not an overwrite.

```scss
@use "abstracts" as *;
.cards {
  @include grid();
  &__item { @include columns(4); }
}
```

The root defaults are 4 columns, rem(8px) gutter, rem(16px) side margin, and
rem(1920px) maximum width. At from(desktop), the count becomes 12. Layout
width and column-width custom properties follow the supplied viewport formula.
No CSS classes are added automatically. The mixins emit flexbox layout; use them
on the container and direct children. columns() requires a positive unitless
integer; gap() accepts nonnegative integers, including zero. Invalid counts and
side names produce Sass errors. Simplified formulas no longer divide by the span
or offset count.

Spacing uses logical properties: gap(1, "start"), gap(1, "end"), or both sides
by default. Legacy "left"/"right" map to logical start/end, including in RTL.
Keep spans within the active responsive column count; Sass cannot validate that
runtime limit. Root column-width tokens describe the outer viewport grid, not a
narrow nested container. For nested grids, set local padding/count/gutters and
recompute any needed width tokens; columns() itself uses its containing block.
Full examples and constraints are in the conventions document.

## Composable catalog

```sh
ms-front-kit add composable useResize
ms-front-kit add composable useDevice
```

Files go into the configured composables directory. Adding useDevice also adds
useResize when missing. Existing files are skipped with a message, including
customized dependencies; no files are overwritten. Nuxt output uses auto-imports.
Vue output prepends the necessary explicit imports.

useResize shares refs and a listener pair across mounted client consumers, with
separate state per SSR call. Measurements update immediately; onResize toggles
after a 200ms debounce. Final unmount removes listeners and cancels the timer.
The foundation sets root `--layout-max-width` to rem(1920px); useResize caps lvw at
that width, but no element's max-width is set automatically. The token supports
px and browser-resolved CSS lengths
such as rem/calc; missing/invalid/nonpositive/percentage/auto values fall back to
viewport width. Zero-height aspect ratios are guarded. svh remains the height
captured when viewport width changes, not a browser small-viewport-unit reading.

useDevice requires the installed styles' base/_device.scss. It reads normalized
body::after content labels; the pseudo-element is reserved for this bridge.
coarsePointer and canHover are separate capability refs. touch uses touch hints,
not the CSS --touch flag. Pointer/hover and DPR changes are monitored independently
of resizing, and all listeners/watchers are released on unmount. Safari, in-app,
and phone/tablet classifications are best-effort hints; prefer feature detection.
Image support helpers are SSR-safe and have bounded browser load checks.
Adding a composable does not install styles automatically.

To grow the catalog, add a template in templates/vue/composables and register its
filename, dependencies, and explicit Vue imports in catalog.json. Keep template
logic separate from installation behavior. Tests cover dependencies and skip
behavior. Existing installations are not upgraded automatically.

## Structure and future additions

```text
src/cli/                          command handling and generation
schemas/                          project config schema
 templates/                       (paths below are relative to templates/)
  vue/components/basic/           shared Vue/Nuxt basic template
  vue/composables/                 composable templates and dependency catalog
  nuxt/composables/                future Nuxt-specific composables
  shared/scss/                    framework-independent SCSS foundation
 tests/                           automated generation tests
```

Only introduce framework-specific overrides when needed. Future React templates
belong in `templates/react/components/` and `templates/react/hooks/`.
Don't assume Vue/Nuxt composables work unchanged during server rendering.
Use explicit Sass module imports for mixins; include global CSS once in the app.

The schema documents the supported initial configuration. The CLI also checks
its supported options before generation; it is not a general JSON-schema engine.
No published schema URL is claimed. Editors can associate the local schema with
`ms-front-kit.json` without committing machine-specific absolute paths.

## Sync between devices

On another device, clone the repository and set up the local command:

```sh
git clone https://github.com/cmacmillanmarin/ms-front-kit.git
cd ms-front-kit
npm ci
npm link
```

Repository access may require GitHub authentication. For updates, commit and push
on the first device, then run `git pull --ff-only` and `npm ci` from the toolkit
directory on the other. This updates future generation, not existing project
code. Client projects build independently of the linked command.
