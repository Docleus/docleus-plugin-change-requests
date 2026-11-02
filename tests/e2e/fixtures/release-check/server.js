// A plugin that contributes a required check, for the end-to-end tests.
// Plain JavaScript, so the server loads it without a build step.
const TICKET = /\bDOC-\d+\b/;

export const plugin = {
  name: "@docleus/e2e-release-check",
  apply(ctx) {
    ctx.on("change-request/checks", (input) => {
      if (!input.title.startsWith("Release")) return;
      const hasTicket = TICKET.test(input.title);
      input.report({
        name: "e2e.release-ticket",
        title: "Release ticket",
        status: hasTicket ? "success" : "failure",
        isRequired: true,
        ...(!hasTicket && { summary: "Name a ticket such as DOC-1." }),
      });
    });
  },
};
