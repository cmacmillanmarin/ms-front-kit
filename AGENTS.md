# Toolkit contributor instructions

## Keep generators and conventions aligned

When changing generated component structure, naming, styling, framework behavior,
or supported commands, review and update the corresponding conventions template,
configuration schema, README, and tests in the same change wherever affected.
Do not leave the instructions describing behavior the generator no longer has.

The basic component example in `templates/vue/conventions.md.tpl` is inserted at
render time from `templates/vue/components/basic/component.vue.tpl`. Keep that
single source of truth; do not maintain a separate hardcoded component example.
Changes to the surrounding prose still require deliberate review.

Run `npm test` after generator or conventions changes. Tests must cover the
rendered example matching generated code, project-specific configuration,
repeat runs, and preservation of existing instructions and customized documents.

## Respect consuming projects

Generated files belong to their projects. Do not silently migrate existing code
or overwrite customized conventions. `add conventions` may create an absent
AGENTS.md, but must leave an existing one untouched and print a suggested reference
when it has none. Keep installation repeatable without duplicate references.

Do not run generators in the sibling playground unless explicitly requested.
Test using temporary directories instead. Do not add frameworks, grid styles,
composables, or mixins beyond the requested scope.
