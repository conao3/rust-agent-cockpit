# Project Rules

## React / JSX

- Do not use `<p>` tags. Use `<div>` instead for all text containers.
- Use TanStack Query (`useQuery` / `useMutation`) for all data fetching. Do not use manual `useState` + `useEffect` loading patterns.

## Code Style

- Use `function` declarations for top-level functions. Do not use `const f = () =>` at the top level.

## Lint

- Run `pnpm knip` after editing code and fix all warnings.
