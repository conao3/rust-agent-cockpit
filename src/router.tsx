import { Link, Outlet, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { HomeRoute } from "./routes/HomeRoute";
import { PlaceholderRoute } from "./routes/PlaceholderRoute";

function RootLayout() {
  return (
    <div className="router-root">
      <header className="router-header">
        <h1 className="router-title">agent-cockpit</h1>
        <nav className="router-nav" aria-label="primary">
          <Link to="/" className="router-link" activeProps={{ className: "router-link is-active" }}>
            cockpit
          </Link>
          <Link
            to="/placeholder"
            className="router-link"
            activeProps={{ className: "router-link is-active" }}
          >
            placeholder
          </Link>
        </nav>
      </header>
      <section className="router-content">
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
