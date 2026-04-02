# Tailwind Design System: Advanced Patterns

Advanced Tailwind CSS v4 patterns including animations, dark mode theming, custom utilities, theme modifiers, namespace overrides, and the v3-to-v4 migration checklist.

## Pattern 5: Native CSS Animations (v4)

```css
@theme {
  --animate-dialog-in: dialog-fade-in 0.2s ease-out;
  --animate-dialog-out: dialog-fade-out 0.15s ease-in;
}

@keyframes dialog-fade-in {
  from { opacity: 0; transform: scale(0.95) translateY(-0.5rem); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}

@keyframes dialog-fade-out {
  from { opacity: 1; transform: scale(1) translateY(0); }
  to { opacity: 0; transform: scale(0.95) translateY(-0.5rem); }
}
```

## Pattern 6: Dark Mode with CSS (v4)

Use class-based dark mode with `@custom-variant dark` (not the v3 `darkMode: "class"` config). Theme provider sets `.dark` on `<html>`, CSS variables handle the rest.

## Custom Utilities with `@utility`

```css
@utility line-t {
  @apply relative before:absolute before:top-0 before:-left-[100vw] before:h-px before:w-[200vw] before:bg-gray-950/5 dark:before:bg-white/10;
}

@utility text-gradient {
  @apply bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent;
}
```

## Theme Modifiers

```css
/* Reference other CSS variables */
@theme inline { --font-sans: var(--font-inter), system-ui; }

/* Always generate CSS variables even when unused */
@theme static { --color-brand: oklch(65% 0.15 240); }
```

## Namespace Overrides

```css
@theme {
  --color-*: initial;  /* Clear all default colors */
  --color-white: #fff;
  --color-primary: oklch(45% 0.2 260);
}
```

## Semi-transparent Color Variants

```css
@theme {
  --color-primary-50: color-mix(in oklab, var(--color-primary) 5%, transparent);
  --color-primary-100: color-mix(in oklab, var(--color-primary) 10%, transparent);
}
```

## v3 to v4 Migration Checklist

- Replace `tailwind.config.ts` with CSS `@theme` block
- Change `@tailwind base/components/utilities` to `@import "tailwindcss"`
- Move color definitions to `@theme { --color-*: value }`
- Replace `darkMode: "class"` with `@custom-variant dark`
- Move `@keyframes` inside `@theme` blocks
- Replace `require("tailwindcss-animate")` with native CSS animations
- Update `h-10 w-10` to `size-10`
- Remove `forwardRef` (React 19 passes ref as prop)
- Consider OKLCH colors for better colour perception
- Replace custom plugins with `@utility` directives

## Best Practices

### Do's
- Use `@theme` blocks (CSS-first configuration)
- Use OKLCH colours (better perceptual uniformity than HSL)
- Compose with CVA (type-safe variants)
- Use semantic tokens (`bg-primary` not `bg-blue-500`)
- Use `size-*` (shorthand for `w-* h-*`)

### Don'ts
- Don't use `tailwind.config.ts` (use CSS `@theme`)
- Don't use `@tailwind` directives (use `@import "tailwindcss"`)
- Don't use arbitrary values (extend `@theme` instead)
- Don't hardcode colours (use semantic tokens)
