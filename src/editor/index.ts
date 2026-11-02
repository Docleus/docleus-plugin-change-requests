import { definePlugin } from "@docleus/sdk";
import { PLUGIN_NAME } from "../shared/index.ts";
import { createApi } from "./api.ts";
import { createApp, createRequestsView } from "./app.tsx";
import {
  PANEL_ID,
  VIEW_ID,
  createBar,
  createChangesView,
  createDraftFinder,
  createPanel,
} from "./edit-mode.tsx";
import { createLiveChanges } from "./live.ts";
import { APP_PATH, REQUESTS_VIEW_ID } from "./navigation.tsx";
import { createEditBranchResolver } from "./resolver.ts";
import { createSettingsPage } from "./settings.tsx";
import { createHomeSection, createSidebar } from "./sidebar.tsx";
import { CHANGE_REQUESTS_CSS } from "./styles.ts";

/**
 * Starts a draft change request on the first edit of a space (or resumes
 * the user's draft), and adds its state and actions to the space top bar,
 * the review panel and Review changes view, the sidebar list, the org
 * home's "Waiting for you", the app and the workflow settings page.
 */
export const plugin = definePlugin({
  name: PLUGIN_NAME,
  inject: ["ui"],
  apply(ctx) {
    const api = createApi(ctx.ui);
    const live = createLiveChanges();
    ctx.ui.registerEditBranch(createEditBranchResolver(api));
    const findDraft = createDraftFinder(api);
    ctx.ui.registerEditDraft((space) => findDraft(space));
    ctx.ui.registerSlot("space.bar", {
      id: PLUGIN_NAME,
      component: createBar(api, ctx.ui, live),
    });
    ctx.ui.registerSlot("space.panel", {
      id: PANEL_ID,
      component: createPanel(api, ctx.ui, live),
    });
    ctx.ui.registerSlot("space.view", {
      id: VIEW_ID,
      component: createChangesView(api, live),
    });
    ctx.ui.registerSlot("space.view", {
      id: REQUESTS_VIEW_ID,
      component: createRequestsView(api),
    });
    ctx.ui.registerSlot("sidebar", {
      id: PLUGIN_NAME,
      component: createSidebar(api, live),
    });
    ctx.ui.registerSlot("org.home", {
      id: PLUGIN_NAME,
      component: createHomeSection(api, live),
    });
    ctx.ui.registerApp({
      path: APP_PATH,
      label: "Change requests",
      component: createApp(),
    });
    ctx.ui.registerSettingsPage({
      id: "change-requests",
      label: "Change requests",
      scopes: ["org", "space"],
      component: createSettingsPage(api),
    });
    ctx.effect(() => {
      const style = document.createElement("style");
      style.dataset.plugin = PLUGIN_NAME;
      style.textContent = CHANGE_REQUESTS_CSS;
      document.head.append(style);
      return () => style.remove();
    }, "change-request styles");
  },
});
