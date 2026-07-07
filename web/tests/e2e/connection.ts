import type { Page } from "@playwright/test";

/** Seeds the same localStorage shape lib/connection.ts reads, before the app's
 * first script runs — every connected-state test needs this. ADR-0019: the
 * connection is now { serverAddress, token, username } under the .v2 key (the
 * `token` here is the harness user's session token, from ChronicleTestServer). */
export async function seedConnection(
  page: Page,
  serverAddress: string,
  token: string,
  username = "e2e-harness-user"
): Promise<void> {
  await page.addInitScript(
    ([addr, tok, user]) => {
      window.localStorage.setItem(
        "chronicle.connection.v2",
        JSON.stringify({ serverAddress: addr, token: tok, username: user })
      );
    },
    [serverAddress, token, username]
  );
}
