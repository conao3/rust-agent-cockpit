import { Link, Outlet, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { HomeRoute } from "./routes/HomeRoute";
import { PlaceholderRoute } from "./routes/PlaceholderRoute";

const navLinkClass =
  "rounded-full border border-slate-600 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-300 transition hover:border-cyan-300 hover:text-cyan-100";

function RootLayout() {
  return (
    <div className="flex h-full w-full flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-slate-800 bg-slate-950/95 px-3 py-2">
        <h1 className="m-0 text-xs font-bold uppercase tracking-[0.14em] text-slate-100">agent-cockpit</h1>
        <nav className="flex gap-2" aria-label="primary">
          <Link
            to="/"
            className={navLinkClass}
            activeProps={{ className: `${navLinkClass} border-cyan-300 bg-cyan-300 text-slate-900` }}
          >
            cockpit
          </Link>
          <Link
            to="/placeholder"
            className={navLinkClass}
            activeProps={{ className: `${navLinkClass} border-cyan-300 bg-cyan-300 text-slate-900` }}
          >
            placeholder
          </Link>
        </nav>
      </header>
      <section className="min-h-0 flex-1">
        <Outlet />
      </section>
    </div>
  );
}

const rootRoute = createRootRoute({
  component: RootLayout,
});

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomeRoute,
});

const placeholderRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/placeholder",
  component: PlaceholderRoute,
});

const routeTree = rootRoute.addChildren([homeRoute, placeholderRoute]);

export const router = createRouter({
  routeTree,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
