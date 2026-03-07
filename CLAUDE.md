# Project Rules

## React / JSX

- Do not use `<p>` tags. Use `<div>` instead for all text containers.
- Use TanStack Query (`useQuery` / `useMutation`) for all data fetching. Do not use manual `useState` + `useEffect` loading patterns.

## Code Style

- Use `function` declarations for top-level functions. Do not use `const f = () =>` at the top level.
- Prefer `satisfies` over `as` for type annotations on object literals. Use `as` only when type narrowing is required (e.g., `as HTMLElement`, `as Record<string, unknown>`).

## Lint

- Run `pnpm knip` after editing code and fix all warnings.
