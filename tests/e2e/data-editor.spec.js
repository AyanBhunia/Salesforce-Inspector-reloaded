import {test, expect} from "./fixtures";
import {
  TEST_CONSTANTS,
  injectSessionData,
  pasteData,
} from "./test-helpers";
import {routeMock} from "./test-mock";

test.describe("Data Editor", () => {
  const {mockHost, mockToken, apiVersion} = TEST_CONSTANTS;

  test.beforeEach(async ({context}) => {
    await injectSessionData(context, {
      host: mockHost,
      token: mockToken,
      version: apiVersion
    });

    await context.route("**/*", async route => {
      if (!TEST_CONSTANTS.mockEnabled) {
        await route.continue();
        return;
      }
      if (await routeMock(route, mockHost)) {
        return;
      }
      await route.continue();
    });
  });

  const header = ["_", "Id", "Name", "Industry"];
  const rows = [
    ["[Account]", "001000000000001AAA", "Acme", "Energy"],
    ["[Account]", "001000000000002AAA", "Globex", "Banking"],
    ["[Account]", "001000000000003AAA", "Initech", ""],
  ];

  async function openWithData(page, extensionId) {
    // Seed the handoff store the same way Data Export does, then open the editor with its key
    await page.goto(`chrome-extension://${extensionId}/data-editor.html?host=${mockHost}`);
    const key = await page.evaluate(async payload => {
      const {saveHandoff} = await import("./data-editor-handoff.js");
      return saveHandoff(payload);
    }, {header, rows, apiType: "Enterprise"});
    await page.goto(`chrome-extension://${extensionId}/data-editor.html?host=${mockHost}&handoff=${key}`);
    await expect(page.locator(".de-grid tbody tr").filter({hasText: "Acme"})).toBeVisible();
  }

  function cell(page, r, c) {
    return page.locator(`.de-grid td[data-r="${r}"][data-c="${c}"]`);
  }

  test("Shows the paste prompt and loads pasted data", async ({page, extensionId}) => {
    await page.goto(`chrome-extension://${extensionId}/data-editor.html?host=${mockHost}`);
    await expect(page.locator(".de-empty")).toContainText("Paste data here");

    await pasteData(page, ".de-empty", "Name\tCity\nAcme\tParis\nGlobex\tLyon\n");

    await expect(page.locator(".de-grid thead th")).toHaveText(["#", "Name", "City"]);
    await expect(cell(page, 1, 1)).toHaveText("Lyon");
    await expect(page.locator(".de-stats")).toHaveText("2 rows");
  });

  test("Edits a cell by typing, then undo and redo", async ({page, extensionId}) => {
    await openWithData(page, extensionId);

    await cell(page, 0, 2).click();
    await page.keyboard.type("Acme Corp");
    await page.keyboard.press("Enter");

    await expect(cell(page, 0, 2)).toHaveText("Acme Corp");
    await expect(cell(page, 0, 2)).toHaveClass(/de-dirty/);
    await expect(page.locator(".de-stats")).toContainText("1 edited");
    // Enter moves the selection down
    await expect(cell(page, 1, 2)).toHaveClass(/de-active/);

    await page.keyboard.press("Control+z");
    await expect(cell(page, 0, 2)).toHaveText("Acme");
    await expect(page.locator(".de-stats")).not.toContainText("edited");

    await page.keyboard.press("Control+y");
    await expect(cell(page, 0, 2)).toHaveText("Acme Corp");
  });

  test("Id and record type columns are read-only", async ({page, extensionId}) => {
    await openWithData(page, extensionId);

    await cell(page, 0, 1).dblclick();
    await expect(page.locator(".de-grid td input")).toHaveCount(0);
    await page.keyboard.type("x");
    await expect(cell(page, 0, 1)).toHaveText("001000000000001AAA");
  });

  test("Fills a selection with Ctrl+Enter and pastes a single value into a range", async ({page, extensionId}) => {
    await openWithData(page, extensionId);

    await cell(page, 0, 3).click();
    await cell(page, 2, 3).click({modifiers: ["Shift"]});
    await page.keyboard.type("Retail");
    await page.keyboard.press("Control+Enter");
    for (let r = 0; r < 3; r++) {
      await expect(cell(page, r, 3)).toHaveText("Retail");
    }
    await expect(page.locator(".de-stats")).toContainText("3 edited");

    await pasteData(page, ".de-grid", "Media");
    for (let r = 0; r < 3; r++) {
      await expect(cell(page, r, 3)).toHaveText("Media");
    }
  });

  test("Adds and deletes rows, sorts and filters", async ({page, extensionId}) => {
    await openWithData(page, extensionId);

    await cell(page, 2, 2).click();
    await page.getByRole("button", {name: "Row", exact: true}).click();
    await expect(page.locator(".de-stats")).toContainText("4 rows");
    await expect(page.locator(".de-stats")).toContainText("1 new");
    // New rows keep the record type so Data Import can detect the object
    await expect(cell(page, 3, 0)).toHaveText("[Account]");

    await page.getByRole("button", {name: "Delete rows"}).click();
    await expect(page.locator(".de-stats")).toHaveText("3 rows");

    await page.locator(".de-grid thead th", {hasText: "Name"}).click();
    await page.locator(".de-grid thead th", {hasText: "Name"}).click();
    await expect(cell(page, 0, 2)).toHaveText("Initech");

    await page.getByPlaceholder("Filter rows").fill("glob");
    await expect(page.locator(".de-stats")).toHaveText("1 of 3 rows");
    await expect(cell(page, 0, 2)).toHaveText("Globex");
  });

  test("Keeps changes hidden by the filter and pastes into an empty filtered view", async ({page, extensionId}) => {
    await openWithData(page, extensionId);

    await cell(page, 0, 3).click();
    await page.keyboard.type("Media");
    await page.keyboard.press("Enter");

    await page.getByPlaceholder("Filter rows").fill("glob");
    await expect(page.getByRole("button", {name: "Send 1 row to Data Import"})).toBeEnabled();

    await page.getByPlaceholder("Filter rows").fill("no match");
    await expect(page.locator(".de-stats")).toContainText("0 of 3 rows");
    await pasteData(page, ".de-grid", "x");
    await expect(page.locator(".de-stats")).toContainText("1 of 4 rows");
  });

  test("Sends only the changes to Data Import", async ({page, context, extensionId}) => {
    await openWithData(page, extensionId);

    await cell(page, 1, 3).click();
    await page.keyboard.type("Insurance");
    await page.keyboard.press("Enter");

    const sendButton = page.getByRole("button", {name: "Send 1 row to Data Import"});
    await expect(sendButton).toBeEnabled();

    const [popup] = await Promise.all([
      context.waitForEvent("page"),
      sendButton.click()
    ]);
    await popup.waitForURL(/data-import.html/);
    const importUrl = popup.url();
    expect(importUrl).toContain("data-import.html");
    expect(importUrl).toContain("handoff=");
    // Extension APIs are not available in tabs opened by window.open under Playwright, so load the URL in a regular page
    await popup.close();

    // Only the record type, the Id and the edited column are sent
    const payload = await page.evaluate(async key => {
      const {loadHandoff} = await import("./data-editor-handoff.js");
      return loadHandoff(key);
    }, new URL(importUrl).searchParams.get("handoff"));
    expect(payload.text).toBe("\"_\"\t\"Id\"\t\"Industry\"\r\n\"[Account]\"\t\"001000000000002AAA\"\t\"Insurance\"");

    // Data Import loads the rows with Update preselected
    await page.goto(importUrl);
    await expect(page.locator("button:has-text('Run Update')")).toBeVisible();
  });
});
