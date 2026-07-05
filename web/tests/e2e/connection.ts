import type { Page } from "@playwright/test";

/** Seeds the same localStorage shape lib/connection.ts reads, before the
 * app's first script runs — every connected-state test needs this. */
export async function seedConnection(page: Page, serverAddress: string, passphrase: string): Promise<void> {
  await page.addInitScript(
    ([addr, pass]) => {
      window.localStorage.setItem("chronicle.connection", JSON.stringify({ serverAddress: addr, passphrase: pass }));
    },
    [serverAddress, passphrase]
  );
}
