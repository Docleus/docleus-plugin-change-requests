/**
 * Styles of the change-request bar item, panel, changes view, sidebar list
 * and app. The host provides the shared vocabulary (`.tag`, `.btn`, `.plist`,
 * `.dfile`, `.drow`, `.panel`); these rules lay out the plugin's own screens
 * and fall back to plain values in a host without the tokens.
 */
export const CHANGE_REQUESTS_CSS = `
.cr-actions { display: flex; flex-direction: column; align-items: stretch; gap: 8px; }
.cr-actions > .btn, .cr-actions > button, .cr-actions > .button { justify-content: center; }
.cr-actions .notice { color: var(--ink-2, #555); }
/* Secondary steps read as links under the one filled button. */
.cr-actions > .btn.is-quiet { order: 2; align-self: flex-start; justify-content: flex-start; height: 24px; padding: 0; }
.cr-actions > .notice { order: 1; }
.cr-actions > .error { order: 3; }
.cr-actions .error { margin: 0; }
.cr-checks { display: grid; gap: 6px; list-style: none; margin: 0; padding-left: 0; }
.cr-check {
  display: inline-flex; align-items: center; gap: 6px; min-width: 4.5rem;
  font: var(--t-ui-strong, 600 13px/18px system-ui, sans-serif);
}
.cr-check-failure { color: var(--del-fg, #a3201b); }
.cr-check-pending { font-weight: 400; color: var(--ink-2, #555); }
.cr-sidebar { margin-top: 12px; }
.cr-sidebar .side-note { padding: 0 8px; }
/* In a host settings section the form brings its own rows; the section supplies the box. */
.section-body:has(> .cr-settings) { padding: 0; }
.cr-settings .row + .row { border-top: 1px solid var(--hair, #e6e6e3); }
.cr-settings .savebar {
  display: flex; align-items: center; gap: 8px; justify-content: flex-end;
  padding: 12px 16px; border-top: 1px solid var(--hair, #e6e6e3); background: var(--rail, #f5f5f4);
}
.cr-settings .savebar > :first-child { margin-right: auto; }
.cr-settings .is-inline { height: auto; padding: 0; font: inherit; color: var(--ink, #111); }
.cr-settings .cr-saved { margin: 0; padding: 12px 16px; border-top: 1px solid var(--hair, #e6e6e3); }
.cr-settings .input { width: 100%; max-width: 360px; }
.cr-app textarea { font: inherit; width: 100%; box-sizing: border-box; }

/* list */
.wrap.cr-app { width: min(880px, 100% - 64px); margin: 0 auto; padding: var(--s6, 32px) 0 120px; }
.cr-app .crumbs { margin-bottom: 12px; color: var(--ink-2, #555); }
.cr-app .crumbs a { color: inherit; text-decoration: none; }
.cr-app .crumbs a:hover { color: var(--ink, #111); text-decoration: underline; }
.wrap.cr-app h1 { margin: 0; font: var(--t-page, 600 26px/34px Georgia, serif); }
.cr-app .filters { display: flex; align-items: center; gap: 8px; margin: 16px 0 8px; }
.cr-app .filters .btn { margin-left: auto; }
.crs { margin: 0; padding: 0; list-style: none; border-top: 1px solid var(--hair, #e6e6e3); }
.crs li {
  display: grid; grid-template-columns: 24px 1fr 120px 96px 40px; gap: 12px; align-items: center;
  min-height: 56px; padding: 6px 8px; border-bottom: 1px solid var(--hair, #e6e6e3); cursor: pointer;
}
.crs li:hover a { text-decoration: underline; text-underline-offset: 3px; }
.crs a { font-weight: 600; text-decoration: none; }
.crs small { display: block; color: var(--ink-2, #555); }
.crs .n { color: var(--ink-2, #555); font: var(--t-mono, 12px/18px ui-monospace, monospace); text-align: right; }
.cr-app .empty-list { padding: 32px 0; color: var(--ink-2, #555); text-align: center; }

/* detail */
.detail.cr-app {
  display: grid; grid-template-columns: minmax(0, 1fr) 280px; gap: 32px;
  width: min(1180px, 100% - 64px); margin: 0 auto; padding: 24px 0 120px;
}
.detail.cr-app h1 { margin: 4px 0 8px; font: var(--t-page, 600 26px/34px Georgia, serif); }
.detail.cr-app .pmeta { display: flex; align-items: center; gap: 8px; margin: 0 0 16px; }
.cr-about { display: grid; justify-items: start; gap: 8px; margin-bottom: 24px; }
.cr-description { margin: 0; white-space: pre-wrap; font: var(--t-read, 17px/28px Georgia, serif); }
.cr-heading { margin: 24px 0 12px; font: var(--t-ui-strong, 600 13px/18px system-ui); color: var(--ink-2, #555); }
.cr-edit-form { margin-bottom: 24px; }
.side-card { position: sticky; top: 16px; align-self: start; }
.side-card section { padding: 12px 0; border-bottom: 1px solid var(--hair, #e6e6e3); }
.side-card section:first-child { padding-top: 0; }
.side-card h3 { margin: 0 0 8px; color: var(--ink-2, #555); font: var(--t-ui-strong, 600 13px/18px system-ui); }
.side-card p { margin: 0; }
.cr-open { margin-top: 8px !important; }
.cr-open .btn { padding: 0; justify-content: flex-start; }
.dfile .dempty { margin: 0; padding: 12px; color: var(--ink-2, #555); }
.dfile button.drow { width: 100%; border: 0; font: inherit; text-align: left; color: inherit; }

/* panel */
.panel .pmeta { display: flex; align-items: center; gap: 8px; margin: 0; }
.panel-note { margin: 8px 0 0; }
.panel-links { display: flex; justify-content: space-between; margin: 12px 0 0; }
.linkish.is-danger { color: var(--del-fg, #a3201b); }

/* conflicts */
.cr-conflict {
  margin: 16px 0; border: 1px solid var(--ink, #111); border-radius: var(--r, 3px); overflow: hidden;
}
.cr-conflict.is-resolved { border-color: var(--hair-2, #cfcfcc); }
.cr-conflict h2 {
  margin: 0; padding: 10px 12px; border-bottom: 1px solid var(--hair, #e6e6e3);
  background: var(--rail, #f5f5f4); font: var(--t-ui-strong, 600 13px/18px system-ui);
}
.cr-sides { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; padding: 12px; }
.cr-side {
  min-width: 0; padding: 12px; border: 1px solid var(--hair-2, #cfcfcc); border-radius: var(--r, 3px);
  transition: border-color 160ms, box-shadow var(--d-press, 272ms) var(--ease-press, ease-out);
}
.cr-side.is-chosen { border-color: var(--ink, #111); box-shadow: inset 0 0 0 1px var(--ink, #111); }
.cr-side h3 { margin: 0 0 6px; font: var(--t-ui-strong, 600 13px/18px system-ui, sans-serif); }
.cr-side p { margin: 4px 0; }
.cr-block-type { font: var(--t-mono, 12px/18px ui-monospace, monospace); color: var(--ink-2, #555); }
.cr-block-text { white-space: pre-wrap; font: var(--t-read, 17px/28px Georgia, serif); font-size: 15px; line-height: 24px; }
.cr-deleted { font-style: italic; color: var(--ink-2, #555); text-decoration: line-through; }
.cr-json { white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; font: var(--t-mono, 12px/18px ui-monospace, monospace); }
.cr-resolved { display: inline-flex; align-items: center; gap: 6px; padding: 0 12px 12px; font-weight: 600; }
@media (max-width: 960px) {
  .detail.cr-app { grid-template-columns: 1fr; }
  .side-card { position: static; }
}
@media (max-width: 720px) {
  .cr-sides { grid-template-columns: 1fr; }
  .crs li { grid-template-columns: 24px 1fr auto; }
  .crs li > :nth-child(4), .crs li > :nth-child(5) { display: none; }
}
`;
