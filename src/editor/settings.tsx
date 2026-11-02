import { useEffect, useState, type FormEvent } from "react";
import type { SettingsPageProps } from "@docleus/sdk";
import type { WorkflowMode, WorkflowSettings } from "../shared/index.ts";
import { workflowPath, type Api, type WorkflowView } from "./api.ts";
import { ErrorView } from "./error-view.tsx";
import { useAction, useLoad } from "./use-load.ts";

const MODE_LABELS: Readonly<Record<WorkflowMode, string>> = {
  "change-requests": "Change requests",
  direct: "Direct editing",
};

const isMode = (value: string): value is WorkflowMode => value in MODE_LABELS;

/** The workflow settings page, at the organization and space levels. */
export function createSettingsPage(api: Api) {
  return function ChangeRequestSettings(props: SettingsPageProps) {
    const { scope } = props;
    const path = workflowPath(scope);
    const loaded = useLoad(path, () => api.call<WorkflowView>("GET", path));
    const action = useAction();
    const [mode, setMode] = useState<WorkflowMode>("change-requests");
    const [approvals, setApprovals] = useState("0");
    const [saved, setSaved] = useState(false);

    useEffect(() => {
      if (!loaded.data) return;
      setMode(loaded.data.workflow.mode);
      setApprovals(String(loaded.data.workflow.requiredApprovals));
    }, [loaded.data]);

    const put = (workflow: WorkflowSettings | null) =>
      action.run("save", async () => {
        setSaved(false);
        await api.call<WorkflowView>("PUT", path, { workflow });
        loaded.reload();
        setSaved(true);
      });

    const onSubmit = (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const requiredApprovals = Number(approvals);
      if (!Number.isInteger(requiredApprovals) || requiredApprovals < 0) {
        action.setError(
          new Error("Required approvals must be a whole number, 0 or more."),
        );
        return;
      }
      void put({ mode, requiredApprovals });
    };

    if (loaded.error !== undefined) return <ErrorView error={loaded.error} />;
    if (!loaded.data) return null;
    const parent = scope.kind === "space" ? "the organization" : "the default";
    const stored = loaded.data.workflow;
    const isDirty =
      mode !== stored.mode || approvals !== String(stored.requiredApprovals);
    const discard = () => {
      setMode(stored.mode);
      setApprovals(String(stored.requiredApprovals));
      action.setError(undefined);
    };
    return (
      <form
        className="cr-settings"
        aria-label="Change request workflow"
        onSubmit={onSubmit}
      >
        <div className="row">
          <div className="label">
            <label htmlFor="cr-mode">
              <strong>Workflow</strong>
            </label>
            {loaded.data.inherited ? (
              <small>Inherited from {parent}.</small>
            ) : (
              <small>
                Set for this {scope.kind === "space" ? "space" : "organization"}
                .{" "}
                <button
                  type="button"
                  className="btn is-quiet is-inline"
                  disabled={action.pending !== undefined}
                  onClick={() => void put(null)}
                >
                  Use {parent}'s
                </button>
              </small>
            )}
          </div>
          <div className="control">
            <select
              id="cr-mode"
              className="input"
              value={mode}
              onChange={(event) => {
                if (isMode(event.target.value)) setMode(event.target.value);
              }}
            >
              {Object.entries(MODE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="row">
          <div className="label">
            <label htmlFor="cr-approvals">
              <strong>Required approvals</strong>
            </label>
            <small>The author's own approval does not count.</small>
          </div>
          <div className="control">
            <input
              id="cr-approvals"
              className="input"
              type="number"
              min={0}
              step={1}
              value={approvals}
              disabled={mode === "direct"}
              onChange={(event) => setApprovals(event.target.value)}
            />
          </div>
        </div>
        {saved && !isDirty && (
          <p role="status" className="cr-saved muted">
            Saved.
          </p>
        )}
        {(isDirty || action.error !== undefined) && (
          <footer className="savebar">
            {action.error !== undefined ? (
              <ErrorView error={action.error} />
            ) : (
              <span className="muted">Unsaved changes</span>
            )}
            <button
              type="button"
              className="btn"
              disabled={action.pending !== undefined}
              onClick={discard}
            >
              Discard
            </button>
            <button
              type="submit"
              className="btn is-primary"
              disabled={action.pending !== undefined || !isDirty}
            >
              Save
            </button>
          </footer>
        )}
      </form>
    );
  };
}
