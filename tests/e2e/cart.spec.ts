import { expect, test } from "@playwright/test";

test.describe("BB-06: Persisted Cart and Multi-tab Synchronization", () => {
  test.use({ serviceWorkers: "block" });

  test("persists cart across reloads and syncs actions between two tabs in real time", async ({ context }) => {
    // Open Tab 1
    const page1 = await context.newPage();
    await page1.goto("/");

    // Tab 1: Add a product directly
    const addSmash = page1.getByRole("button", { name: "Agregar Smash Búnker Doble" });
    await expect(addSmash).toBeVisible();
    await addSmash.click();

    // Verify Tab 1 badge shows 1 product
    await expect(page1.getByLabel("Carrito, 1 productos")).toBeVisible();

    // Open Tab 2 in the same browser context (shares localStorage)
    const page2 = await context.newPage();
    await page2.goto("/");

    // Verify Tab 2 immediately loaded the persisted cart
    await expect(page2.getByLabel("Carrito, 1 productos")).toBeVisible();
    await expect(page2.locator("#carrito").getByText("Smash Búnker Doble")).toBeVisible();

    // Tab 2: Increase quantity in cart
    const plusButton = page2.getByRole("button", { name: "Agregar uno de Smash Búnker Doble" });
    await plusButton.click();
    await expect(page2.getByLabel("Carrito, 2 productos")).toBeVisible();

    // Verify Tab 1 synced the quantity increase via StorageEvent
    await expect(page1.getByLabel("Carrito, 2 productos")).toBeVisible();

    // Tab 1: Reload page and ensure persistence is preserved
    await page1.reload();
    await expect(page1.getByLabel("Carrito, 2 productos")).toBeVisible();

    // Tab 2: Empty the cart
    const clearCartBtn = page2.getByRole("button", { name: "Vaciar carrito completo" });
    await clearCartBtn.click();
    await expect(page2.getByLabel("Carrito, 0 productos")).toBeVisible();
    await expect(page2.getByText("Tu carrito está vacío")).toBeVisible();

    // Verify Tab 1 synced the empty cart
    await expect(page1.getByLabel("Carrito, 0 productos")).toBeVisible();
    await expect(page1.getByText("Tu carrito está vacío")).toBeVisible();

    await page1.close();
    await page2.close();
  });

  test("allows custom line editing without losing notes or quantities", async ({ page }) => {
    await page.goto("/");

    // Open customization drawer for Smash Búnker Doble
    const smashCard = page.getByRole("article").filter({ hasText: "Smash Búnker Doble" });
    await smashCard.getByRole("button", { name: /Ver Smash Búnker Doble/i }).click();

    const drawer = page.getByRole("dialog", { name: "Personalizar Smash Búnker Doble" });
    await expect(drawer).toBeVisible();

    // Select Triple patty (+ option)
    await drawer.getByRole("radio", { name: /Triple/i }).click();

    // Add note
    const notesInput = drawer.getByLabel("Aclaraciones para la cocina");
    await notesInput.fill("Sin pepinillos por favor");

    // Increase quantity to 2
    const incBtn = drawer.getByRole("button", { name: "Aumentar cantidad" });
    await incBtn.click();

    // Submit line
    await drawer.getByRole("button", { name: /Agregar 2 al carrito/i }).click();
    await expect(drawer).not.toBeVisible();

    // Cart shows 2 items
    await expect(page.getByLabel("Carrito, 2 productos")).toBeVisible();
    await expect(page.locator("#carrito").getByText("Sin pepinillos por favor")).toBeVisible();

    // Click Edit button
    await page.getByRole("button", { name: "Editar Smash Búnker Doble" }).click();
    const editDrawer = page.getByRole("dialog", { name: "Personalizar Smash Búnker Doble" });
    await expect(editDrawer).toBeVisible();

    // Verify quantity and notes are preserved in the edit drawer
    await expect(editDrawer.getByLabel("Aclaraciones para la cocina")).toHaveValue("Sin pepinillos por favor");
    await expect(editDrawer.getByText("2", { exact: true })).toBeVisible();

    // Edit notes and save
    await editDrawer.getByLabel("Aclaraciones para la cocina").fill("Sin pepinillos ni mayonesa");
    await editDrawer.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(editDrawer).not.toBeVisible();

    // Verify updated notes in cart
    await expect(page.locator("#carrito").getByText("Sin pepinillos ni mayonesa")).toBeVisible();
    await expect(page.getByLabel("Carrito, 2 productos")).toBeVisible();
  });
});
