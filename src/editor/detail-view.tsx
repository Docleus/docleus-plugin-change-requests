import { useState, type FormEvent } from "react";
import type { ChangeRequest, EntryChange } from "../shared/index.ts";
import {
  crPath,
  currentUserId,
  getChangeRequest,
  type Api,
  type SpaceRef,
} from "./api.ts";
import {
  ChangeRequestActions,
  isActive,
  StatusBadge,
  When,
} from "./actions.tsx";
import { ChecksList } from "./checks-list.tsx";
import { DiffTools, PageDiff } from "./diff-view.tsx";
import { ErrorView } from "./error-view.tsx";
import { appHref, Link, spaceHref } from "./navigation.tsx";
import { useAction, useLoad } from "./use-load.ts";

function EditForm(props: {
  readonly api: Api;
  readonly space: SpaceRef;
  readonly changeRequest: ChangeRequest;
  onSaved(): void;
  onCancel(): void;
}) {
  const { changeRequest } = props;
  const [title, setTitle] = useState(changeRequest.title);
  const [description, setDescription] = useState(changeRequest.description);
  const action = useAction();
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (title.trim() === "") {
      action.setError(new Error("The title must not be empty."));
      return;
    }
    void action.run("save", async () => {
      await props.api.call<unknown>(
        "PATCH",
        crPath(props.space, changeRequest.number),
        { title: title.trim(), description },
      );
      props.onSaved();
    });
  };
  return (
    <form
      className="stacked-form cr-edit-form"
      aria-label="Edit change request"
      onSubmit={onSubmit}
    >
      <label>
        Title
        <input
          value={title}
          required
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <label>
        Description
        <textarea
          value={description}
          rows={5}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <p>
        <button type="submit" disabled={action.pending !== undefined}>
          Save
        </button>{" "}
        <button type="button" onClick={props.onCancel}>
          Cancel
        </button>
      </p>
      {action.error !== undefined && <ErrorView error={action.error} />}
    </form>
  );
}

export function DetailView(props: {
  readonly api: Api;
  readonly space: SpaceRef;
  readonly number: number;
}) {
  const { api, space, number } = props;
  const key = `${space.orgId}/${space.spaceId}/${number}`;
  const detail = useLoad(key, () => getChangeRequest(api, space, number));
  const userId = useLoad("me", () => currentUserId(api));
  const [version, setVersion] = useState(0);
  const changes = useLoad(`${key}#${version}`, () =>
    api
      .call<{ changes: EntryChange[] }>(
        "GET",
        `${crPath(space, number)}/changes?bodies=1`,
      )
      .then((result) => result.changes),
  );
  const [isSplit, setIsSplit] = useState(false);
  const [isEditing, setEditing] = useState(false);

  const reload = () => {
    detail.reload();
    setVersion((n) => n + 1);
  };

  if (detail.error !== undefined) {
    return (
      <div className="wrap cr-app">
        <ErrorView error={detail.error} />
      </div>
    );
  }
  if (!detail.data) return <p className="loading">Loading…</p>;
  const { changeRequest, state } = detail.data;
  const isLive = isActive(changeRequest);

  return (
    <div className="detail cr-app">
      <div className="detail-main">
        <nav className="crumbs" aria-label="Breadcrumb">
          <Link href={appHref(space)}>← Change requests</Link>
        </nav>
        <h1>
          #{number} {changeRequest.title}
        </h1>
        <p className="pmeta">
          <StatusBadge status={changeRequest.status} />
          <span className="muted">
            {changeRequest.authorName} opened it{" "}
            <When at={changeRequest.createdAt} />
            {changeRequest.mergedAt !== undefined && (
              <>
                , merged <When at={changeRequest.mergedAt} />
              </>
            )}
          </span>
        </p>
        {isEditing ? (
          <EditForm
            api={api}
            space={space}
            changeRequest={changeRequest}
            onSaved={() => {
              setEditing(false);
              detail.reload();
            }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <div className="cr-about">
            {changeRequest.description === "" ? (
              <p className="notice">No description.</p>
            ) : (
              <p className="cr-description">{changeRequest.description}</p>
            )}
            {isLive && state.canEdit && (
              <button
                type="button"
                className="btn is-quiet"
                onClick={() => setEditing(true)}
              >
                Edit title and description
              </button>
            )}
          </div>
        )}
        <h2 className="cr-heading">Changes</h2>
        {changes.error !== undefined && <ErrorView error={changes.error} />}
        {changes.data?.length === 0 && (
          <p className="notice">No changes yet.</p>
        )}
        {changes.data && changes.data.length > 0 && (
          <>
            <DiffTools
              count={changes.data.length}
              isSplit={isSplit}
              onSplit={setIsSplit}
            />
            {changes.data.map((change) => (
              <PageDiff
                key={change.entryId}
                change={change}
                isSplit={isSplit}
                {...(isLive &&
                  change.kind !== "removed" && {
                    href: spaceHref(
                      space,
                      changeRequest.branch,
                      change.entryId,
                    ),
                  })}
              />
            ))}
          </>
        )}
      </div>
      <aside className="side-card" aria-label="Status">
        {isLive && (
          <section>
            <h3>Actions</h3>
            <ChangeRequestActions
              api={api}
              space={space}
              detail={detail.data}
              userId={userId.data}
              onChange={detail.reload}
              onRebased={reload}
              onFinished={reload}
            />
            <p className="cr-open">
              <Link
                className="btn is-quiet"
                href={spaceHref(space, changeRequest.branch)}
              >
                Open in editor
              </Link>
            </p>
          </section>
        )}
        {isLive && (
          <section>
            <h3>Checks</h3>
            <ChecksList checks={state.checks} />
          </section>
        )}
        <section>
          <h3>Approvals</h3>
          {changeRequest.approvals.length === 0 ? (
            <p className="muted">
              {state.requiredApprovals > 0
                ? "No approvals yet."
                : "None needed in this space."}
            </p>
          ) : (
            isLive && (
              <p className="muted">
                Approvals count for the latest changes only.
              </p>
            )
          )}
          {changeRequest.approvals.length > 0 && (
            <ul className="plist">
              {changeRequest.approvals.map((approval) => (
                <li key={approval.userId}>
                  <span className="ic ic-check" />
                  <span className="ell">{approval.name}</span>
                  <span className="r muted">
                    <When at={approval.at} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>
    </div>
  );
}
