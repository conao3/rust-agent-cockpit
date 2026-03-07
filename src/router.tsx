import { Link, Outlet, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { HomeRoute } from "./routes/HomeRoute";
import { MvpRoute } from "./routes/MvpRoute";
import { SettingsRoute } from "./routes/SettingsRoute";
import { TaskLifecycleRoute } from "./routes/TaskLifecycleRoute";

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
            mvp
          </Link>
          <Link
            to="/cockpit"
            className={navLinkClass}
            activeProps={{ className: `${navLinkClass} border-cyan-300 bg-cyan-300 text-slate-900` }}
          >
            cockpit
          </Link>
          <Link
            to="/settings"
            className={navLinkClass}
            activeProps={{ className: `${navLinkClass} border-cyan-300 bg-cyan-300 text-slate-900` }}
          >
            settings
          </Link>
          <Link
            to="/agent-cockpit/$cockpit_id/tasks"
            params={{ cockpit_id: "default" }}
            className={navLinkClass}
            activeProps={{ className: `${navLinkClass} border-cyan-300 bg-cyan-300 text-slate-900` }}
          >
            tasks
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
  component: MvpRoute,
});

const cockpitRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/cockpit",
  component: HomeRoute,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsRoute,
});

const taskLifecycleRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/agent-cockpit/$cockpit_id/tasks",
  component: TaskLifecycleRoute,
});

const routeTree = rootRoute.addChildren([homeRoute, cockpitRoute, settingsRoute, taskLifecycleRoute]);

export const router = createRouter({
  routeTree,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
