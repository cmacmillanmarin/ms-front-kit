# Macmillan Studio frontend conventions

This project uses **{{framework}}**. Read `ms-front-kit.json` for its configured
paths and options. These conventions guide new or intentionally modified code;
do not rewrite unrelated existing code. More-specific project instructions take
precedence. If instructions conflict, explain the conflict before proceeding.

## Initialization and optional font callbacks

`ms-front-kit.json` is personal configuration. Init excludes it through Git's
local `info/exclude`, not the shared `.gitignore`. Keep generated application
source tracked. Without Git, init warns that the config is not excluded; add
the local exclusion once Git is initialized. Already tracked files are not
untracked automatically.

`ms-front-kit init --framework nuxt` creates configuration and
`app/plugins/ms-front-kit.client.ts`, then runs `npm install gsap` to update the
project's package.json and npm lockfile. The paths shown are Nuxt 4 defaults;
init parses literal `srcDir`, `dir.assets`, and `dir.plugins` settings to place
files in the configured source, assets, and plugin directories. It does not
execute config code. Dynamic, layered, or environment-specific layouts need
manual setup. Review custom component/composable scanning separately. Existing
config or plugin files are not overwritten. `--no-install` skips dependency installation; install
gsap using the project's package manager before running the app. Vue init remains
config-only; do not copy a Nuxt plugin into a plain Vue application.

The client plugin prints the studio credit, registers GSAP CustomEase, and defines
an example named `ms-ease`. GSAP defaults are duration 0.8 seconds and ease
`ms-ease`; individual tweens can override them. Import
gsap in components where needed; registering CustomEase does not auto-import gsap.

The font-loading block is entirely commented out. Enable it only after the
matching font CSS/assets are installed. It uses the native document.fonts API,
not webfontloader. Adjust the font family and weight to match @font-face, and
provide project-specific onFontsLoaded/onFontFallback callbacks. An empty result
means no matching face was registered, not successful loading. A three-second
timeout or load failure uses the fallback callback. Do not await this check from
the plugin or hide/block the entire app while waiting. The example checks one
face; explicitly load additional faces if the UI depends on them.

## Components

- Create components under `{{componentsPath}}` using PascalCase directories
  and filenames. Paths passed to the CLI are relative to this component root.
- Prefer `ms-front-kit add component Home/Hero/BackButton` from the project
  root. It creates `{{componentsPath}}/Home/Hero/BackButton.vue`.
- If the CLI is unavailable, follow the structure below manually. Projects must
  build without a local installation of the toolkit.
- Use Vue single-file components with `<script setup lang="ts">`, followed by
  `<template>` and unscoped `<style lang="scss">`. Do not add `scoped`.
- Always use a wrapper `div`. Its first class is the full component path,
  converting each segment to kebab-case and joining with `__`:
  `Home/Hero/BackButton` becomes `home__hero__back-button`.
  `ProductCard` becomes `product-card`; `XMLViewer` becomes `xml-viewer`.
  The configured component root is not part of the class name.
  For entry-point components named exactly `Index`, omit only the final `Index`
  segment from the class: `Header/Index` becomes `header` and
  `Home/Header/Index` becomes `home__header`. Keep the file path unchanged
  (`Header/Index.vue`). A standalone `Index` still uses `index`; other names
  and intermediate `Index` directories follow the normal rule.
- This path-prefixed namespace is a studio convention, not strict single-level
  BEM. Use the full root as the prefix for elements and modifiers, for example
  `home__hero__back-button__icon` and `home__hero__back-button--disabled`.
  Do not add empty placeholder elements, modifiers, or unused styles.
- Keep selectors under the full component namespace. Unscoped CSS is global:
  path prefixes reduce collisions but cannot eliminate them, particularly with
  generic selectors or duplicate names. Avoid bare global element selectors.
- Commented examples in the generator are optional scaffolding reminders, not
  required component content. When creating or implementing a component with AI,
  omit unused prop, emit, lifecycle, and import examples. Include only the active
  code the requested behavior needs; do not copy unused commented boilerplate.
- The script includes commented examples for typed defineProps with reactive
  destructuring and a native default (requires Vue 3.5+), defineEmits with
  zero/one/multiple parameters, and onBeforeMount/onMounted/onBeforeUnmount,
  plus a commented Vue import. Destructure directly from defineProps, not from
  an intermediate props object. The Vue compiler preserves reactivity for uses
  in the same script setup block. For watch or getter-based composables, pass
  `() => label` rather than the current value `label`; it is not a ref.
  Older Vue versions need the props-object pattern instead.
  Uncomment only what the component needs. In Nuxt, lifecycle hooks may already
  be auto-imported; plain Vue requires the import. Compiler macros defineProps
  and defineEmits do not need imports.
  Vue 3 uses onBeforeUnmount, not beforeDestroy.
- The basic generator includes a name paragraph inside the wrapper, with no
  slot: `<p class="product-card__name">ProductCard</p>`. Its text is the
  component filename without `.vue` (`Index` for an Index entry point), and its
  class is the wrapper's BEM namespace plus `__name`. Do not add styles just for
  this placeholder. Replace or remove it when implementing the requested
  behavior, including in AI-generated components; it is not required content
  for finished components. Add slots manually only when needed. Keep the
  required wrapper and don't add unrelated features.

### Basic component example

This example is rendered directly from the same template as the generator:

```vue
{{componentExample}}
```

## Styling

- Use SCSS for generated component styles. The project needs `sass` as a
  development dependency.
- The kit foundation lives in `{{stylesPath}}/ms-front-kit/`, separate from
  existing project files. Run `ms-front-kit add styles` from
  the project root to copy the foundation and register its entry in Nuxt or Vue.
  Generating this document does not install styles; verify the files exist before importing.
- The installer preserves existing stylesheet entries, avoids duplicate imports,
  and refuses to overwrite customized SCSS. It supports direct Nuxt config
  objects with literal CSS arrays and Vue's `src/main.ts` or `src/main.js` entry.
  It also merges a Vite `resolve.alias.abstracts` entry pointing to the installed
  abstracts directory: under `vite` in Nuxt config, or in the root Vue Vite
  config. Existing plugins, aliases, and comments are preserved. A missing Vue
  Vite config is created. Dynamic config objects, array-form aliases, CommonJS
  Vite configs, and conflicting abstracts aliases require manual setup and stop
  installation before changes. Dynamic Nuxt config expressions require the manual setup below. It prints a
  Sass installation command if no compiler is declared; it does not install dependencies.
- Install the compiler with `npm install --save-dev sass`.
- `main.scss` emits global CSS and must be included once. `abstracts/_index.scss`
  exposes variables, `rem()`, and the `font-size`, `from`, and `type` mixins
  without emitting CSS.
- The reset only normalizes box sizing, body margin, and form-control fonts.
  It deliberately preserves native headings, lists, links, and focus outlines.
- Keep the browser's root font size. Body text starts at `1rem` with a line-height
  of `1.5`. Do not set every descendant's font size or assume 1rem equals 10px.
- Put runtime CSS custom properties in `base/_tokens.scss`; build-time defaults
  and maps live in `abstracts/_variables.scss`. Add font declarations only in
  `base/_fonts.scss`, loaded globally once. Each typography token explicitly
  selects the registered example font with a sans-serif fallback. Root tokens contain example primary
  and secondary colors plus layout tokens. The maximum is `rem(1920px)`
  (120rem with the default design reference); customize per project. Font defaults stay in Sass.
- In components, import Sass tools only when needed using `@use "abstracts" as *;`
  at the start of the style block. The shared Vue/Nuxt generator includes it
  commented out. Do not use a namespace such as `ms` in new component styles.
  `add styles` configures the Vite alias needed to resolve this bare module name.
  For manual installation or older installations, add the alias shown below
  before uncommenting; global CSS registration alone does not provide it.
- AI-generated components must reuse the installed SCSS mixins and functions
  whenever applicable instead of hand-writing equivalent declarations or calculations:
  use `type()` for typography tokens, `font-size()` for custom text sizes,
  `from()` for named breakpoints, and the grid tools for matching grid layouts.
  Write ordinary SCSS only where no existing helper fits; do not invent helpers
  or force grid layouts where they are not needed.
- Always use `rem()` for design lengths that should scale with accessible text
  sizing: font sizes, length-based line heights, letter spacing, and padding,
  margins, gaps, or dimensions around text. For example, use `padding: rem(24px)`
  and `margin-block: rem(16px)`, not raw px or manually converted rem literals.
  `type()` and `font-size()` already perform the conversion internally. Keep
  unitless line-height ratios and zero unitless; retain percentages, intrinsic
  sizing, and viewport units when their layout meaning is required. Fixed
  decorative details such as hairline borders may use px. Do not constrain text
  with fixed heights that clip when enlarged; prefer intrinsic sizing or min-height.
- Grid tools are included by add styles: `grid()`, `columns($count)`,
  and `gap($count, $side)`. No global grid classes are generated automatically.
  React integration is not provided yet. add styles sets styles.grid to true.

### Manual Nuxt installation

Copy the SCSS directory contents into `{{stylesPath}}/ms-front-kit/`, preserving its structure.
Merge the entry into the existing `nuxt.config.ts` CSS array, without removing
other entries or adding it twice. For the default `app/assets/scss` layout:

```ts
export default defineNuxtConfig({
  css: ["@/assets/scss/ms-front-kit/main.scss"],
});
```

Components use `@use "abstracts" as *;`. For manual installation, merge this
Vite alias into the existing Nuxt config (paths are relative to nuxt.config):

```ts
import { fileURLToPath } from "node:url";

export default defineNuxtConfig({
  vite: {
    resolve: {
      alias: {
        abstracts: fileURLToPath(new URL("./{{stylesPath}}/ms-front-kit/abstracts", import.meta.url)),
      },
    },
  },
});
```

Keep the global CSS entry too. Loading main.scss does
not make Sass mixins available automatically in component styles. Nuxt's existing
`@` alias resolves relative to srcDir (app/ by default in Nuxt 4); do not redefine
it. The installer honors a literal srcDir setting and uses the existing root
alias `@@` if the configured styles directory is outside srcDir. Dynamic srcDir
expressions require manual setup.

### Manual Vue installation (Vite)

Copy the SCSS directory contents into `{{stylesPath}}/ms-front-kit/`. Import its `main.scss` once
from the application's JavaScript/TypeScript entry. With the default
`src/assets/scss` layout, `src/main.ts` uses:

```ts
import "./assets/scss/ms-front-kit/main.scss";
```

Adjust that relative path for the configured styles directory. Components use
`@use "abstracts" as *;`. For manual installation, merge the alias into the
existing root Vite config without replacing plugins or other aliases:

```ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    alias: {
      abstracts: fileURLToPath(new URL("./{{stylesPath}}/ms-front-kit/abstracts", import.meta.url)),
    },
  },
});
```

Do not assume an `@` alias exists or import the global entry into components.

The installer puts the kit entry before existing Nuxt CSS entries or Vue entry
imports. Folder isolation prevents file conflicts, not global CSS conflicts:
review the reset and typography before combining them with another foundation.
The copied files belong to the project; edit the kit's main.scss to select modules.
For manual composition, remove its direct app entry and load it from your project
stylesheet with `@use "./ms-front-kit/main";` before project overrides. Do not use
both loading methods. Existing project styles are never moved into the kit folder.

### Installed font example: Helvetica Now Display Medium

`add styles` automatically copies the example asset from
`templates/shared/fonts/HelveticaNowDisplayMedium.woff2` into
`public/assets/font/HelveticaNowDisplayMedium.woff2` and registers it in
`{{stylesPath}}/ms-front-kit/base/_fonts.scss`. Existing identical assets are
preserved; a different file at that location stops installation before edits.
Confirm your license permits use in this project and any sharing of the font;
its presence in the toolkit is not a redistribution license. Automatic copying
assumes the standard public/ directory; adapt manually for a custom public path.

The installed declaration is:

```scss
@font-face {
  font-family: "Helvetica Now Display";
  src: url("/assets/font/HelveticaNowDisplayMedium.woff2") format("woff2");
  font-weight: 500;
  font-style: normal;
  font-display: swap;
}
```

The URL is root-relative: public/ is not part of the URL. Adapt it to your
actual base path or asset host when deploying under a subdirectory or CDN.
`base/_fonts.scss` is already loaded by the kit's global main.scss; do not load
font registration again from components or abstracts.

The example typography tokens already select this family. For other text,
apply it with a fallback and the matching supplied weight:

```scss
.example {
  font-family: "Helvetica Now Display", sans-serif;
  font-weight: 500;
}
```

Edit `font-family` directly in each typography token in
`{{stylesPath}}/ms-front-kit/abstracts/_variables.scss`.
Every token has its own family; changing body does not change h1, h2, or small.
Set the intended body weight to 500 explicitly if using
this single Medium face globally. This example does not supply regular, bold,
or italic files; don't declare one static file as a variable font or multiple
weights. Add separately licensed faces when those weights are required.

### Development grid overlay

`add styles` also creates `{{componentsPath}}/Helper/Grid.vue` and mounts it in
the app shell in development mode only. Nuxt uses `<srcDir>/app.vue` (normally
`app/app.vue`) with `import.meta.dev`; Vue/Vite uses `src/App.vue` with
`import.meta.env.DEV`. The generated mount imports the helper explicitly using
its relative path; do not assume custom directories are auto-scanned by Nuxt.
A missing app shell is created. Existing helpers and mounts are preserved,
including project customizations; repeat runs do not duplicate them. If the
app's scripts/template cannot be safely merged, the CLI preserves the app and
prints manual mounting instructions. Layered/dynamic Nuxt layouts also require
manual mounting. Do not replace existing application content to add the helper.

Keep the helper development-only when moving it into a layout. For manual
mounting, merge an import for `MsFrontKitGrid` from the helper's actual relative
path and `const msFrontKitDev = import.meta.dev` (Nuxt) or
`const msFrontKitDev = import.meta.env.DEV` (Vue/Vite) into script setup, then add
`<MsFrontKitGrid v-if="msFrontKitDev" />` beside the app content. Neither the
overlay nor its button should render in production. Do not add another mount
when an existing HelperGrid mount already provides this behavior.

The helper uses `grid()` and `columns(1)` with the installed layout tokens,
12 spans, and clipped extra rows for the default four-column mobile layout.
Customize it if the project changes those grid defaults. It does not depend
on useResize/useDevice. The toggle persists visibility in localStorage under
`helper-grid-visible`; storage is accessed after mount, and failures are safe.
Keep its accessible button label/pressed state, pointer-transparent overlay,
and aria-hidden visualization. `styles.grid` marks the SCSS foundation's
installation, not the helper's visibility. Generated helpers belong to the
project and must not be silently replaced during toolkit updates.

### Flex grid tools

```scss
@use "abstracts" as *;

.home__cards {
  @include grid();

  &__item {
    @include columns(4);

    @include from(desktop-large) {
      @include columns(6);
    }
  }
}

.home__cards__offset {
  @include gap(1, "start");
}
```

The root starts with 4 columns, rem(8px) gutters, rem(16px) side margins, and a
rem(1920px) maximum width. It switches to 12 columns at desktop (1024px
with the design reference); no separate breakpoint named large exists.
--layout-width excludes side margins and inter-column gutters, and
--layout-column-width divides that available width by the column count.

The grid mixin creates a wrapping flex container, not CSS Grid. Apply columns()
to its direct children, using positive unitless integers within the active column
count. Sass validates the integer but cannot know the responsive runtime count;
keep spans within 4 or 12 as appropriate. gap() accepts nonnegative integers,
including zero to reset an offset. Invalid counts or side names produce errors.

Container padding/margins and offsets use logical properties for RTL support.
Use gap(1, "start"), gap(1, "end"), or gap(1, "both"); omitting the side applies
both. Legacy "left" and "right" mean logical start and end, not physical sides.
Formulas divide only by the layout column count, not by the requested count.

The root width/column-width tokens describe the outer viewport-based grid only.
Do not use them to size narrower nested grids. columns() percentages resolve
against the immediate container; nested grids can use those, but their own
padding, column count, and gutter must be chosen deliberately. Repeated grid()
adds another set of side margins as padding. Override these settings locally
when nesting, and recompute local width tokens if you need them. Keep descendants
from unintentionally overriding inherited --columns/--gap helper properties.
Ensure the reset's border-box sizing is loaded.

### Using and customizing Sass tools

Import abstracts without a namespace and use the existing tools as needed:

```scss
@use "abstracts" as *;

.home__hero__back-button {
  @include type(body);
  @include font-size(20px); // emits 1.25rem with the default reference
  padding: rem(24px); // emits 1.5rem

  @include from(tablet) {
    padding-inline: rem(32px);
  }
}
```

The example typography tokens are `h1` (48px), `h2` (32px), `body` (16px), and
`small` (14px). The global typography file applies h1, h2, and body examples.
Write design sizes in px in the `$types` map in `abstracts/_variables.scss`.
`type()` converts px font-size,
line-height, and letter-spacing values, preserving unitless line heights.
Typography tokens each include font-family, font-size, and line-height, with no
shared font-family or line-height variables. All example tokens select
("Helvetica Now Display", sans-serif); edit each independently. type(body)
applies the family as well as size and line height, with no separate declaration.

The shared `rem()` function divides px values by `$design-root-size`, declared
only in `abstracts/_variables.scss` (16px by default). The body design-size token
uses that same setting, so its default output stays 1rem. Edit this one setting
rather than defining another conversion base in variables or functions.
`font-size(24px)` emits `font-size: 1.5rem`. Keep the browser root size unchanged;
these are design conversions, not guaranteed rendered pixel sizes. Media-query
rem units use the browser's initial font size, not a custom html font-size.

The kit's default breakpoints are `tablet` 561px,
`tablet-landscape` 769px, `desktop` 1024px, `desktop-medium` 1280px,
`desktop-large` 1441px, and `desktop-x-large` 1800px. `from()` converts the values
to rem, e.g. tablet emits 35.0625rem.
Unknown token names and invalid rem() input produce a Sass error.
These are editable starting values. Edit the copied
variables file to apply consistent defaults across independently compiled Vue
style blocks. Sass `with (...)` configuration is local to a compilation and does
not automatically configure every component. Use CSS custom properties for
runtime theming. Keep global utilities out of the abstracts module.

Components that add animation or smooth scrolling must consider
`prefers-reduced-motion`; the foundation does not enable either globally.

## Composables and framework behavior

- Project composables belong in `{{composablesPath}}`.
- Available commands: `ms-front-kit add composable useResize` and
  `ms-front-kit add composable useDevice`. useDevice also adds useResize when
  missing. Existing files, including customized dependencies, are skipped with
  a message and are never overwritten.
- Nuxt templates retain auto-imports. Vue output adds explicit Vue imports and
  a relative useResize import.
- useResize shares viewport refs and one resize/visualViewport listener pair
  between mounted client consumers. SSR calls get independent state. The final
  consumer's unmount removes listeners and cancels pending debounce work.
- The foundation defines `--layout-max-width` as rem(1920px) on the root. useResize
  uses it to cap lvw; it does not constrain layout elements automatically.
  You can override it per project, including with CSS lengths such as `120rem`. CSS lengths such as rem/calc
  are resolved through a temporary hidden element. Missing, invalid, nonpositive,
  percentage, or auto values fall back to viewport width. vr is zero at zero
  height. svh retains its existing meaning: the height captured at a width change.
- The onResize boolean toggles after a 200ms debounce, while measurements update
  immediately on events. It is a notification flag, not a resize-in-progress flag.
  Treat shared refs as measurements rather than assigning to them from consumers.
- useDevice reads body::after content from base/_device.scss, included in the
  kit's main.scss. Install those styles before using it. Breakpoint content is
  returned without CSS quote characters. Labels use double hyphens
  (tablet--landscape, desktop--medium, etc.) while Sass keys use single hyphens.
- useDevice exposes coarsePointer and canHover separately from touch. Touch uses
  touch-capability hints, not the CSS coarse-pointer flag. Pointer/hover media
  changes, focus, and resolution changes refresh capabilities/DPR without needing
  a window resize; listeners and its resize watcher are cleaned up on unmount.
- safari, inAppBrowser, and isPhoneOrTablet remain best-effort compatibility
  hints, not reliable feature detection. Prefer coarsePointer/canHover or the
  actual API capability. iPad desktop-style user agents have a touch-aware hint.
- webpSupport() and avifSupport() return false safely during SSR and return
  false on browser decode failure or after a three-second timeout. They check
  one-pixel test images and clean up handlers/timers when settled.
- Calling add composable does not install or update styles automatically. If
  an older style installation differs, merge the new device module and main
  import deliberately; don't overwrite project customizations.
- Do not assign body::after to unrelated visual content when useDevice is used.
- Respect the project's actual auto-import setup. Plain Vue generally needs
  explicit imports; Nuxt auto-import behavior depends on its configuration.
- In server-rendered code, do not access browser-only APIs during server setup.
  Use appropriate client lifecycle handling and avoid sharing mutable per-user
  state across server requests.

## Ownership and updates

This conventions document is a personal coding aid. add conventions excludes only
this document through Git's local info/exclude, not through shared .gitignore
rules. AGENTS.md remains shareable and is never excluded by the kit. Existing
project instructions remain untouched. The generated reference requires agents to
read and follow these conventions when present; only the file's presence is
optional. When absent, continue normally without creating or fetching it. Shared
project requirements take precedence over conflicting local conventions. Rules
needed by every contributor belong in tracked project instructions. Exclusions
do not untrack files already in Git; never remove shared instructions
automatically or force-add personal files.

Generated files belong to this project and may be edited. Updating the toolkit
does not automatically update this document or existing components. Review
convention changes explicitly and preserve project-specific decisions.
