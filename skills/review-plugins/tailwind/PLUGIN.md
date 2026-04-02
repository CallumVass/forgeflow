---
name: Tailwind CSS
description: Review checks for Tailwind CSS v4 usage, design tokens, and component patterns
triggers:
  files: ["*.tsx", "*.jsx", "*.css"]
  content: ["className=", "cn(", "cva(", "@apply", "@theme", "tailwind", "tailwind-merge", "clsx"]
---

## Additional Review Checks

Apply these checks to any changed code that uses Tailwind CSS. Use the same evidence and confidence requirements as the core checklist.

### Design Tokens

- Hardcoded color/spacing values instead of design tokens (e.g., `bg-[#1a1a1a]` instead of `bg-background`)
- Inconsistent token usage across related components (one uses `text-primary`, sibling uses `text-blue-500`)
- Magic numbers in arbitrary values that should be tokens (e.g., `p-[13px]` instead of a spacing scale value)

### Component Patterns

- Duplicate class combinations that should be extracted into a CVA variant or shared utility
- `cn()` / `clsx()` calls with conflicting classes (e.g., `cn("p-4", "p-2")` where last wins but intent is unclear)
- Missing `tailwind-merge` when dynamically combining className props with internal classes (override conflicts)
- Conditional classes with complex ternaries that should be variant-based

### Responsive & Accessibility

- Missing responsive breakpoints on layout-critical elements (grid/flex containers with fixed assumptions)
- Interactive elements missing focus-visible styles
- Colour contrast concerns — light text on light backgrounds or dark-on-dark that tokens should prevent
- Missing dark mode variants on elements that have explicit light-mode colours

### Tailwind v4 Specifics

- Using deprecated v3 patterns: `darkMode: "class"` config instead of `@custom-variant dark`
- Using `theme.extend.colors` in JS config instead of CSS `@theme` directive
- Importing Tailwind plugins that are now native in v4 (container queries, animations)

## References

If a finding requires deeper context, read the relevant file from `references/`:

- `references/advanced-patterns.md` — Native CSS animations, dark mode theming, custom utilities, `@theme` modifiers, namespace overrides, v3-to-v4 migration checklist
