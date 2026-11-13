import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ConsoleApp } from "./Shell";
import { i18next } from "@/lib/i18n";
import {
  emptyDecisionDraft,
  readDecisionDraft,
} from "@/lib/console/decision-draft";

const question = "Should we launch the new pilot before December?";
const demoKey = "kayroslab.decision-draft.v1:demo";
const realKey = "kayroslab.decision-draft.v1:live:tenant_1:user_1";
let role = "comex";
let failRun = false;
let threads: unknown[] = [];
const runs: { body: Record<string, unknown> }[] = [];
const agents = ["finance", "legal"].map((id) => ({
  agent_id: id,
  display_name: id,
  role_name: id,
  department: id,
  mission: `Review ${id}`,
  enabled: true,
  metadata: {},
}));
const session = {
  session_id: "committee_1",
  name: "Investment committee",
  collective: {
    active_agents: ["finance", "legal"],
    voting_threshold: "unanimous",
  },
};
function mockLive() {
  localStorage.setItem("kayroslab.console.token", "test-token");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.split("?")[0];
      const response = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        });
      if (path.endsWith("/auth/me"))
        return response({
          user: {
            id: "user_1",
            tenantId: "tenant_1",
            email: "member@example.test",
            role,
          },
        });
      if (path.endsWith("/members/me"))
        return response({
          role,
          permissions:
            role === "lecteur" ? ["read"] : ["read", "run", "arbitrate"],
        });
      if (path.endsWith("/agents")) return response({ agents });
      if (path.endsWith("/sessions")) return response({ sessions: [session] });
      if (path.endsWith("/threads")) return response({ threads });
      for (const kind of [
        "companies",
        "projects",
        "skills",
        "contexts",
        "members",
      ])
        if (path.endsWith(`/${kind}`)) return response({ [kind]: [] });
      if (path.endsWith("/run") && init?.method === "POST") {
        runs.push({ body: JSON.parse(String(init.body)) });
        if (failRun)
          return response({ error: "Review service unavailable" }, 503);
        threads = [
          {
            thread_id: "accepted_1",
            room_id: "committee_1",
            question,
            status: "running",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            messages: [],
          },
        ];
        return response({ thread_id: "accepted_1" });
      }
      return response({ error: "Not found" }, 404);
    }),
  );
}
const next = () =>
  fireEvent.click(
    screen.getByRole("button", { name: "Continue" }),
  );
async function prepare() {
  fireEvent.change(await screen.findByLabelText(/The decision to make/), {
    target: { value: question },
  });
  next();
  fireEvent.change(
    screen.getByLabelText("Context and constraints", { exact: false }),
    { target: { value: "The pilot has a maximum budget of EUR 20000." } },
  );
  fireEvent.change(screen.getByLabelText("Title and provenance"), {
    target: { value: "Budget report · finance · 2026-11-14" },
  });
  fireEvent.change(screen.getByLabelText("Source text"), {
    target: {
      value:
        "Approved budget: EUR 20000. Revenue remains an unverified assumption.",
    },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add to case" }));
  next();
  next();
  expect(
    screen
      .getByRole("button", { name: "Continue" })
      .hasAttribute("disabled"),
  ).toBe(true);
  fireEvent.click(
    screen.getByRole("checkbox", { name: /I have reviewed the committee/ }),
  );
  next();
}

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  runs.length = 0;
  role = "comex";
  failRun = false;
  threads = [];
  window.location.hash = "instruire";
  await i18next.changeLanguage("en");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 401 })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

describe("guided decision onboarding", () => {
  it("requires a real question, preserves the draft across language and navigation, and requires governance review", async () => {
    const first = render(<ConsoleApp />);
    expect(
      screen
        .getByRole("button", { name: "Continue" })
        .hasAttribute("disabled"),
    ).toBe(true);
    fireEvent.change(screen.getByLabelText(/The decision to make/), {
      target: { value: question },
    });
    next();
    fireEvent.change(screen.getByLabelText(/Context and constraints/), {
      target: { value: "A user-authored context, kept verbatim." },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "fr" }));
    });
    expect(
      (screen.getByLabelText(/Contexte et contraintes/) as HTMLTextAreaElement)
        .value,
    ).toBe("A user-authored context, kept verbatim.");
    first.unmount();
    await i18next.changeLanguage("en");
    render(<ConsoleApp />);
    expect(
      (screen.getByLabelText(/Context and constraints/) as HTMLTextAreaElement)
        .value,
    ).toBe("A user-authored context, kept verbatim.");
    expect(JSON.parse(sessionStorage.getItem(demoKey)!).question).toBe(
      question,
    );
  });
  it("launches once with actual source text and clears the live draft only after server acceptance", async () => {
    mockLive();
    render(<ConsoleApp />);
    await prepare();
    expect(runs).toHaveLength(0);
    const launch = screen.getByRole("button", { name: "Start the review" });
    fireEvent.click(launch);
    fireEvent.click(launch);
    await waitFor(() => expect(window.location.hash).toContain("accepted_1"));
    expect(runs).toHaveLength(1);
    expect(runs[0].body).toMatchObject({ question, profile: "fast" });
    expect(runs[0].body.context).toContain(
      "Revenue remains an unverified assumption.",
    );
    expect(sessionStorage.getItem(realKey)).toBeNull();
  });
  it("keeps the question and source text when the API rejects a launch", async () => {
    mockLive();
    failRun = true;
    render(<ConsoleApp />);
    await prepare();
    fireEvent.click(screen.getByRole("button", { name: "Start the review" }));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Review service unavailable",
    );
    const kept = JSON.parse(sessionStorage.getItem(realKey)!);
    expect(kept.question).toBe(question);
    expect(kept.evidence[0].text).toContain("unverified assumption");
    expect(window.location.hash).toBe("#instruire");
    expect(
      screen
        .getByRole("button", { name: "Start the review" })
        .hasAttribute("disabled"),
    ).toBe(false);
  });
  it("does not submit a decision for a read-only member", async () => {
    role = "lecteur";
    mockLive();
    render(<ConsoleApp />);
    await prepare();
    const launch = screen.getByRole("button", { name: "Start the review" });
    expect(launch.hasAttribute("disabled")).toBe(true);
    fireEvent.click(launch);
    expect(runs).toHaveLength(0);
  });
  it("does not revive demo or other-account drafts in an authenticated workspace", async () => {
    sessionStorage.setItem(
      demoKey,
      JSON.stringify({
        ...emptyDecisionDraft("foreign", "demo"),
        question: "Private demo draft",
      }),
    );
    sessionStorage.setItem(
      "kayroslab.decision-draft.v1:live:other:user_1",
      JSON.stringify({
        ...emptyDecisionDraft("foreign", "fast"),
        question: "Other tenant draft",
      }),
    );
    mockLive();
    render(<ConsoleApp />);
    expect(
      (
        (await screen.findByLabelText(
          /The decision to make/,
        )) as HTMLTextAreaElement
      ).value,
    ).toBe("");
  });
  it("rejects oversized or malformed stored context rather than silently truncating it", () => {
    const fallback = emptyDecisionDraft("local", "demo");
    sessionStorage.setItem(
      demoKey,
      JSON.stringify({
        ...fallback,
        evidence: [{ name: "Large", type: "text", text: "x".repeat(24000) }],
      }),
    );
    expect(readDecisionDraft(demoKey, fallback)).toEqual(fallback);
    sessionStorage.setItem(
      demoKey,
      JSON.stringify({ ...fallback, evidence: [null] }),
    );
    expect(readDecisionDraft(demoKey, fallback)).toEqual(fallback);
  });
});
