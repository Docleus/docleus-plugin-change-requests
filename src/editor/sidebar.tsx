import type { OrgSlotProps, Space, SpaceSlotProps } from "@docleus/sdk";
import type { CSSProperties } from "react";
import type { ChangeRequest } from "../shared/index.ts";
import { currentUserId, listChangeRequests, type Api } from "./api.ts";
import { When } from "./actions.tsx";
import { statusWord, tagClass } from "./edit-mode.tsx";
import { ErrorView } from "./error-view.tsx";
import { useLiveVersion, type LiveChanges } from "./live.ts";
import { appHref, Link, navigate, spaceHref } from "./navigation.tsx";
import { useLoad } from "./use-load.ts";

/** Where a change request opens: your own draft in the editor, others in the app. */
function hrefOf(
  space: { orgId: string; spaceId: string },
  changeRequest: ChangeRequest,
  userId: string | undefined,
): string {
  return changeRequest.status === "draft" && changeRequest.author === userId
    ? spaceHref(space, changeRequest.branch)
    : appHref(space, changeRequest.number);
}

/** The `sidebar` list of the space's active change requests. */
export function createSidebar(api: Api, live: LiveChanges) {
  return function ChangeRequestSidebar(props: SpaceSlotProps) {
    const space = { orgId: props.orgId, spaceId: props.spaceId };
    const version = useLiveVersion(live);
    // Reloads on branch switches, which is when a change request appears or goes.
    const list = useLoad(
      `${props.orgId}/${props.spaceId}#${props.branch}.${version}`,
      () => listChangeRequests(api, space),
    );
    const userId = useLoad("me", () => currentUserId(api));
    if (list.error !== undefined) return <ErrorView error={list.error} />;
    if (!list.data) return null;
    return (
      <nav className="cr-sidebar" aria-label="Change requests">
        <div className="side-label">
          <Link href={appHref(space)}>Change requests</Link>
        </div>
        {list.data.length === 0 && (
          <p className="notice side-note">No open change requests.</p>
        )}
        {list.data.map((changeRequest) => {
          const href = hrefOf(space, changeRequest, userId.data);
          const isCurrent = props.branch === changeRequest.branch;
          return (
            <Link
              key={changeRequest.number}
              className="side-link"
              href={href}
              aria-current={isCurrent ? "page" : undefined}
              aria-label={`#${changeRequest.number} ${changeRequest.title}`}
              {...(href.startsWith("/orgs/") && {
                onNavigate: () => props.openBranch(changeRequest.branch),
              })}
            >
              <span className="ell">{changeRequest.title}</span>
              <span className="count">
                <span className={tagClass(changeRequest)}>
                  {statusWord(changeRequest)}
                </span>
              </span>
            </Link>
          );
        })}
      </nav>
    );
  };
}

interface Waiting {
  readonly key: string;
  readonly title: string;
  readonly where: string;
  readonly at: number;
  readonly href: string;
  readonly isReview: boolean;
}

/**
 * The org home's "Waiting for you": your drafts, and change requests in
 * review that you can approve and have not yet.
 */
export function createHomeSection(api: Api, live: LiveChanges) {
  return function WaitingForYou(props: OrgSlotProps) {
    const version = useLiveVersion(live);
    const waiting = useLoad(`waiting/${props.orgId}#${version}`, async () => {
      const [userId, { spaces }] = await Promise.all([
        currentUserId(api),
        api.call<{ spaces: Space[] }>(
          "GET",
          `/api/orgs/${encodeURIComponent(props.orgId)}`,
        ),
      ]);
      const out: Waiting[] = [];
      await Promise.all(
        spaces.map(async (space) => {
          const ref = { orgId: props.orgId, spaceId: space.id };
          const list = await listChangeRequests(api, ref).catch(() => []);
          for (const changeRequest of list) {
            const isMine = changeRequest.author === userId;
            const isDraft = changeRequest.status === "draft";
            const isApproved = changeRequest.approvals.some(
              (each) => each.userId === userId,
            );
            if (isMine ? !isDraft : isDraft || isApproved) continue;
            out.push({
              key: `${space.id}/${changeRequest.number}`,
              title: changeRequest.title,
              where: `${space.name} · ${isMine ? "your draft" : `review for ${changeRequest.authorName}`}`,
              at: changeRequest.updatedAt,
              href: hrefOf(ref, changeRequest, userId),
              isReview: !isMine,
            });
          }
        }),
      );
      return out.toSorted((a, b) => b.at - a.at);
    });
    if (waiting.error !== undefined) return <ErrorView error={waiting.error} />;
    if (!waiting.data) return null;
    return (
      <section aria-label="Waiting for you">
        <h2>Waiting for you</h2>
        {waiting.data.length === 0 ? (
          <p className="work-empty">
            Nothing waiting. Reviews and your drafts show up here.
          </p>
        ) : (
          <ul className="work">
            {waiting.data.map((item, i) => (
              <li
                key={item.key}
                className="stagger"
                style={{ "--i": i } as CSSProperties}
                onClick={() => navigate(item.href)}
              >
                <span
                  className={`ic ${item.isReview ? "ic-clock" : "ic-cr"}`}
                />
                <Link
                  href={item.href}
                  onClick={(event) => event.stopPropagation()}
                >
                  {item.title}
                </Link>
                <span className="where">{item.where}</span>
                <span className="when">
                  <When at={item.at} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  };
}
