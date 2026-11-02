import { useState, type CSSProperties } from "react";
import type { ChangeRequest } from "../shared/index.ts";
import {
  crPath,
  listChangeRequests,
  type Api,
  type SpaceRef,
  type StatusFilter,
} from "./api.ts";
import { StatusBadge, When } from "./actions.tsx";
import { ErrorView } from "./error-view.tsx";
import { appHref, Link, navigate } from "./navigation.tsx";
import { useAction, useLoad } from "./use-load.ts";

const FILTERS: readonly { value: StatusFilter; label: string }[] = [
  { value: "active", label: "Draft or in review" },
  { value: "draft", label: "Drafts" },
  { value: "open", label: "In review" },
  { value: "merged", label: "Merged" },
  { value: "closed", label: "Closed" },
  { value: "all", label: "All" },
];

export function ListView(props: {
  readonly api: Api;
  readonly space: SpaceRef;
}) {
  const { api, space } = props;
  const [status, setStatus] = useState<StatusFilter>("active");
  const list = useLoad(`${space.orgId}/${space.spaceId}?${status}`, () =>
    listChangeRequests(api, space, status),
  );
  const action = useAction();
  const create = () =>
    action.run("create", async () => {
      const { changeRequest } = await api.call<{
        changeRequest: ChangeRequest;
      }>("POST", crPath(space), {});
      navigate(appHref(space, changeRequest.number));
    });

  return (
    <div className="wrap cr-app">
      <h1>Change requests</h1>
      <div className="filters">
        <span className="seg" role="group" aria-label="Status">
          {FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              aria-pressed={status === filter.value}
              onClick={() => setStatus(filter.value)}
            >
              {filter.label}
            </button>
          ))}
        </span>
        <button
          type="button"
          className="btn"
          disabled={action.pending !== undefined}
          onClick={() => void create()}
        >
          New change request
        </button>
      </div>
      {action.error !== undefined && <ErrorView error={action.error} />}
      {list.error !== undefined && <ErrorView error={list.error} />}
      {list.data?.length === 0 && (
        <p className="empty-list">No change requests here.</p>
      )}
      {list.data && list.data.length > 0 && (
        <ul className="crs">
          {list.data.map((changeRequest, i) => (
            <li
              key={changeRequest.number}
              className="stagger"
              style={{ "--i": i } as CSSProperties}
              onClick={() => navigate(appHref(space, changeRequest.number))}
            >
              <span className="ic ic-cr" />
              <span>
                <Link
                  href={appHref(space, changeRequest.number)}
                  onClick={(event) => event.stopPropagation()}
                >
                  #{changeRequest.number} {changeRequest.title}
                </Link>
                <small>by {changeRequest.authorName}</small>
              </span>
              <span>
                <StatusBadge status={changeRequest.status} />
              </span>
              <span className="muted">
                <When at={changeRequest.updatedAt} />
              </span>
              <span className="n">
                {changeRequest.approvals.length > 0
                  ? `✓${changeRequest.approvals.length}`
                  : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
