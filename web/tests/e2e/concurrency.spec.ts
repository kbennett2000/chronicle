import { test, expect } from "./harness";

test.describe("Single-flight turn lock (issue #31)", () => {
  test("two turns submitted concurrently for one campaign — exactly one runs, the other gets 409", async ({
    request,
    chronicleServer,
  }) => {
    // A real Agent SDK turn takes real seconds even on haiku, and this
    // fires two at once.
    test.setTimeout(120_000);

    const { baseURL, token, campaignId } = chronicleServer;
    const headers = { "X-Chronicle-Token": token, "Content-Type": "application/json" };

    // The server tracks the active session in-memory per campaign; a turn
    // can only be submitted after session/start (otherwise every turn 409s
    // for "no active session", which would mask the lock we're testing).
    const started = await request.post(`${baseURL}/campaigns/${campaignId}/session/start`, {
      headers,
      data: {},
    });
    expect(started.status()).toBe(200);

    // Drive it via the API, not the UI: the in-page `sending` guard in
    // Play.tsx blocks a second submit in the same tab, so a raw double-POST
    // is the only way to reproduce the cross-tab / double-submit race this
    // lock exists to close (issue #31).
    const submit = () =>
      request.post(`${baseURL}/campaigns/${campaignId}/turns`, {
        headers,
        data: { message: "I draw my weapon and attack whatever's lurking in the shadows ahead." },
      });

    const [a, b] = await Promise.all([submit(), submit()]);
    const statuses = [a.status(), b.status()].sort();

    // Exactly one turn ran (200 success or 502 engine error — both are the
    // turn actually executing) and exactly one was rejected as in-progress.
    const accepted = statuses.filter((s) => s === 200 || s === 502);
    const rejected = statuses.filter((s) => s === 409);
    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // The 409 carries the single-flight message, not the "no active session"
    // 409 (which can't happen here — the session is started above).
    const rejectedResponse = a.status() === 409 ? a : b;
    const body = await rejectedResponse.json();
    expect(body.error).toContain("already in progress");
  });
});
