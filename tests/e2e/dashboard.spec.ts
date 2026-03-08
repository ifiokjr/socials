import { expect, test } from "@playwright/test";

test.describe("Login gate", () => {
  test("unauthenticated user sees login screen, not dashboard", async ({ page }) => {
    await page.goto("/");
    // Login screen should be visible
    const loginScreen = page.locator("#login-screen");
    await expect(loginScreen).toBeVisible();

    // Should have the GitHub login button
    const loginBtn = page.locator("#login-btn");
    await expect(loginBtn).toBeVisible();
    await expect(loginBtn).toContainText("Sign in with GitHub");

    // Dashboard should be hidden
    const dashboard = page.locator("#dashboard-screen");
    await expect(dashboard).toBeHidden();
  });

  test("login screen shows app title and tagline", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".login-hero h1")).toContainText("Socials");
    await expect(page.locator(".login-tagline")).toContainText(
      "Write once, publish everywhere",
    );
  });

  test("login screen shows all 11 platform icons", async ({ page }) => {
    await page.goto("/");
    const icons = page.locator(".login-platforms span");
    await expect(icons).toHaveCount(11);
  });

  test("login button links to /auth/login", async ({ page }) => {
    await page.goto("/");
    const loginBtn = page.locator("#login-btn");
    await expect(loginBtn).toHaveAttribute("href", "/auth/login");
  });

  test("loading screen disappears after auth check", async ({ page }) => {
    await page.goto("/");
    // After auth check completes, loading should be hidden
    const loading = page.locator("#loading-screen");
    await expect(loading).toBeHidden();
  });
});

test.describe("API — unauthenticated", () => {
  test("health endpoint returns ok", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.timestamp).toBeTruthy();
  });

  test("/api/me returns null user", async ({ request }) => {
    const res = await request.get("/api/me");
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.user).toBeNull();
  });

  test("protected routes return 401", async ({ request }) => {
    const routes = [
      { method: "GET", path: "/api/publications" },
      { method: "GET", path: "/api/platforms" },
      { method: "GET", path: "/api/storage" },
    ];

    for (const route of routes) {
      const res = await request.fetch(`http://localhost:3000${route.path}`, {
        method: route.method,
      });
      expect(res.status()).toBe(401);
    }
  });

  test("publish requires auth", async ({ request }) => {
    const res = await request.post("/api/publish", {
      data: { gistId: "abc" },
    });
    expect(res.status()).toBe(401);
  });

  test("/auth/login redirects to GitHub", async ({ request }) => {
    const res = await request.fetch("http://localhost:3000/auth/login", {
      maxRedirects: 0,
    });
    expect(res.status()).toBe(302);
    const location = res.headers()["location"];
    expect(location).toContain("github.com/login/oauth/authorize");
  });
});
