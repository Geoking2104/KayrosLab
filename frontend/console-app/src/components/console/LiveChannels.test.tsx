import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LiveChannels } from "./LiveChannels";
import { liveState } from "@/lib/console/api";

type Route = (url: string, init?: RequestInit) => { status: number; body: unknown };
function mockFetch(route: Route) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const { status, body } = route(url, init);
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}
const ME = { user: { id: "u1", email: "a@example.com", role: "comex" } };
const CONNECTORS = { encrypted_storage: true, connectors: [
  { platform: "slack", status: "connected", enabled: true, source: "environment", one_click: true },
  { platform: "teams", status: "not_configured", enabled: false, one_click: false },
  { platform: "discord", status: "not_configured", enabled: false, one_click: true },
  { platform: "salesforce", status: "not_configured", enabled: false },
] };

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("liveState", () => {
  it("derives states only from server data", () => {
    expect(liveState({ platform: "teams", status: "not_configured", enabled: false, one_click: false })).toBe("missing_config");
    expect(liveState({ platform: "discord", status: "not_configured", enabled: false, one_click: true })).toBe("connectable");
    expect(liveState({ platform: "slack", status: "connected", enabled: true })).toBe("connected");
    expect(liveState({ platform: "slack", status: "error", enabled: false })).toBe("error");
  });
});

describe("LiveChannels", () => {
  it("shows a Demo badge and a login form when logged out, without calling the API", () => {
    const fetch = mockFetch(() => ({ status: 500, body: {} }));
    render(<LiveChannels />);
    expect(screen.getByTestId("demo-badge")).toBeTruthy();
    expect(screen.getByRole("form")).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("logs in, then lists real connector states with required server variables", async () => {
    const fetch = mockFetch((url) => {
      if (url.endsWith("/v1/auth/login")) return { status: 200, body: { token: "tok", user: ME.user } };
      if (url.endsWith("/v1/auth/me")) return { status: 200, body: ME };
      if (url.endsWith("/v1/console/connectors")) return { status: 200, body: CONNECTORS };
      return { status: 404, body: {} };
    });
    const onSession = vi.fn();
    const { container } = render(<LiveChannels onSession={onSession} />);
    fireEvent.change(container.querySelector('input[type="email"]')!, { target: { value: "a@example.com" } });
    fireEvent.change(container.querySelector('input[type="password"]')!, { target: { value: "pw" } });
    fireEvent.submit(screen.getByRole("form"));
    await screen.findByTestId("live-teams");
    expect(screen.getByText("TEAMS_APP_ID")).toBeTruthy();
    expect(screen.getByText("TEAMS_BOT_PASSWORD")).toBeTruthy();
    expect(screen.queryByTestId("live-salesforce")).toBeNull();
    expect(screen.getAllByRole("button", { name: /connect/i })).toHaveLength(1); // discord only
    const authed = fetch.mock.calls.find(([u]) => String(u).endsWith("/v1/console/connectors"))!;
    expect((authed[1]!.headers as Record<string, string>).authorization).toBe("Bearer tok");
    expect(localStorage.getItem("kayroslab.console.token")).toBe("tok");
    expect(onSession).toHaveBeenLastCalledWith(true);
    expect(screen.queryByText(/MICROSOFT_APP_ID/)).toBeNull();
  });

  it("connect button calls the connect endpoint and follows the returned URL", async () => {
    localStorage.setItem("kayroslab.console.token", "tok");
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    mockFetch((url, init) => {
      if (url.endsWith("/v1/auth/me")) return { status: 200, body: ME };
      if (url.endsWith("/v1/console/connectors")) return { status: 200, body: CONNECTORS };
      if (url.endsWith("/v1/console/connectors/discord/connect") && init?.method === "POST") return { status: 200, body: { url: "https://discord.com/oauth2/authorize?x=1", mode: "invite" } };
      return { status: 404, body: {} };
    });
    render(<LiveChannels />);
    fireEvent.click(await screen.findByRole("button", { name: /connect/i }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://discord.com/oauth2/authorize?x=1"));
  });

  it("returns to logged-out state on 401 and shows API errors otherwise", async () => {
    localStorage.setItem("kayroslab.console.token", "old");
    mockFetch(() => ({ status: 401, body: { error: "unauthorized" } }));
    render(<LiveChannels />);
    await screen.findByTestId("demo-badge");
    expect(localStorage.getItem("kayroslab.console.token")).toBeNull();
    cleanup();
    localStorage.setItem("kayroslab.console.token", "tok");
    mockFetch(() => ({ status: 502, body: { error: "upstream down" } }));
    render(<LiveChannels />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/upstream down/);
  });
});
