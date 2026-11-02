import type { MergeCheck, MergeCheckStatus } from "@docleus/sdk";

const STATUS_LABELS: Readonly<Record<MergeCheckStatus, string>> = {
  pending: "Pending",
  success: "Passed",
  failure: "Failed",
};

/** The checks plugins reported for the change request's head. */
export function ChecksList(props: { readonly checks: readonly MergeCheck[] }) {
  if (props.checks.length === 0) {
    return <p className="notice">No checks reported.</p>;
  }
  return (
    <ul className="cr-checks" aria-label="Checks">
      {props.checks.map((check) => (
        <li key={check.name}>
          <span className={`cr-check cr-check-${check.status}`}>
            {STATUS_LABELS[check.status]}
          </span>{" "}
          {check.url === undefined ? (
            check.title
          ) : (
            <a href={check.url} target="_blank" rel="noreferrer">
              {check.title}
            </a>
          )}
          {check.isRequired && " (required)"}
          {check.summary !== undefined && ` – ${check.summary}`}
        </li>
      ))}
    </ul>
  );
}
