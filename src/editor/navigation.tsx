import type { AnchorHTMLAttributes, MouseEvent } from "react";
import { MAIN_BRANCH } from "@docleus/sdk";
import type { SpaceRef } from "./api.ts";

const enc = encodeURIComponent;

export const APP_PATH = "change-requests";

/** The `space.view` that shows the list, one change request, or its conflicts. */
export const REQUESTS_VIEW_ID = "change-requests.requests";

/**
 * The change requests of a space, inside the space so its tree stays in the
 * sidebar: `?view=change-requests.requests[&cr=<number>[&conflicts=1]]`.
 */
export function appHref(
  space: SpaceRef,
  number?: number,
  view?: "conflicts",
): string {
  let href = `/orgs/${enc(space.orgId)}/spaces/${enc(space.spaceId)}?view=${enc(REQUESTS_VIEW_ID)}`;
  if (number !== undefined) href += `&cr=${number}`;
  if (view === "conflicts") href += "&conflicts=1";
  return href;
}

/** The space (or one of its pages) in the host, shown at `branch`. */
export function spaceHref(
  space: SpaceRef,
  branch: string,
  entryId?: string,
): string {
  let href = `/orgs/${enc(space.orgId)}/spaces/${enc(space.spaceId)}`;
  if (entryId !== undefined) href += `/pages/${enc(entryId)}`;
  if (branch !== MAIN_BRANCH) href += `?branch=${enc(branch)}`;
  return href;
}

/**
 * Client-side navigation the way the host's router expects it: a history
 * entry plus a `popstate` event, which the router listens to.
 */
export function navigate(href: string, options?: { replace?: boolean }): void {
  if (options?.replace) history.replaceState(null, "", href);
  else history.pushState(null, "", href);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function isPlainClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return !(
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  );
}

/** A link that navigates in place, or runs `onNavigate` instead. */
export function Link(
  props: AnchorHTMLAttributes<HTMLAnchorElement> & {
    readonly href: string;
    onNavigate?(): void;
  },
) {
  const { onNavigate, ...rest } = props;
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    props.onClick?.(event);
    if (!isPlainClick(event)) return;
    event.preventDefault();
    if (onNavigate) onNavigate();
    else navigate(props.href);
  };
  return <a {...rest} onClick={onClick} />;
}
