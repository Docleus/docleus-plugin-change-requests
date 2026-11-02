import { useEffect, useSyncExternalStore } from "react";
import type { SpaceViewProps } from "@docleus/sdk";
import type { Api, SpaceRef } from "./api.ts";
import { ConflictsView } from "./conflicts-view.tsx";
import { DetailView } from "./detail-view.tsx";
import { ListView } from "./list-view.tsx";
import { appHref, navigate } from "./navigation.tsx";

const subscribe = (onChange: () => void) => {
  addEventListener("popstate", onChange);
  return () => removeEventListener("popstate", onChange);
};

/** `location.search`, updated on the host's client-side navigation. */
function useLocationSearch(): string {
  return useSyncExternalStore(subscribe, () => location.search);
}

export type AppRoute =
  | { readonly view: "list"; readonly orgId: string; readonly spaceId: string }
  | {
      readonly view: "detail" | "conflicts";
      readonly orgId: string;
      readonly spaceId: string;
      readonly number: number;
    };

function decode(segment: string): string | undefined {
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
}

/** Parses the path after `/apps/change-requests/`. */
export function parseAppPath(path: string): AppRoute | undefined {
  const segments = path.split("/").filter(Boolean);
  const [org, space, numberText, view, ...rest] = segments;
  if (org === undefined || space === undefined || rest.length > 0) {
    return undefined;
  }
  const orgId = decode(org);
  const spaceId = decode(space);
  if (orgId === undefined || spaceId === undefined) return undefined;
  if (numberText === undefined) return { view: "list", orgId, spaceId };
  if (!/^[1-9][0-9]*$/.test(numberText)) return undefined;
  const number = Number(numberText);
  if (view === undefined) return { view: "detail", orgId, spaceId, number };
  if (view === "conflicts")
    return { view: "conflicts", orgId, spaceId, number };
  return undefined;
}

/** Reads the route of the requests view from a space URL's query. */
export function parseViewQuery(
  space: SpaceRef,
  search: string,
): AppRoute | undefined {
  const params = new URLSearchParams(search);
  const numberText = params.get("cr");
  if (numberText === null) return { view: "list", ...space };
  if (!/^[1-9][0-9]*$/.test(numberText)) return undefined;
  const number = Number(numberText);
  return {
    view: params.get("conflicts") === "1" ? "conflicts" : "detail",
    ...space,
    number,
  };
}

function RouteView(props: {
  readonly api: Api;
  readonly route: AppRoute | undefined;
}) {
  const { api, route } = props;
  if (!route) {
    return (
      <div className="wrap cr-app">
        <p role="alert">Not found.</p>
      </div>
    );
  }
  const space = { orgId: route.orgId, spaceId: route.spaceId };
  const key = `${route.orgId}/${route.spaceId}`;
  if (route.view === "list")
    return <ListView key={key} api={api} space={space} />;
  if (route.view === "detail") {
    return (
      <DetailView
        key={`${key}/${route.number}`}
        api={api}
        space={space}
        number={route.number}
      />
    );
  }
  return (
    <ConflictsView
      key={`${key}/${route.number}`}
      api={api}
      space={space}
      number={route.number}
    />
  );
}

/** The list, a change request and its conflicts, as a view of the space. */
export function createRequestsView(api: Api) {
  return function RequestsView(props: SpaceViewProps) {
    const search = useLocationSearch();
    const space = { orgId: props.orgId, spaceId: props.spaceId };
    return <RouteView api={api} route={parseViewQuery(space, search)} />;
  };
}

/** `/apps/change-requests/...` from before the view: sends links to it. */
export function createApp() {
  return function ChangeRequestsApp(props: { readonly path: string }) {
    const route = parseAppPath(props.path);
    useEffect(() => {
      if (!route) return;
      const space = { orgId: route.orgId, spaceId: route.spaceId };
      navigate(
        route.view === "list"
          ? appHref(space)
          : appHref(
              space,
              route.number,
              route.view === "conflicts" ? "conflicts" : undefined,
            ),
        { replace: true },
      );
    });
    if (!route) {
      return (
        <div className="wrap cr-app">
          <p role="alert">Not found.</p>
        </div>
      );
    }
    return null;
  };
}
