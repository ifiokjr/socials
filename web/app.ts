// ─── API Client ──────────────────────────────────

const api = {
  async get<T>(path: string): Promise<T> {
    const res = await fetch(`/api${path}`);
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
  },

  async post<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(`/api${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error ?? `API error: ${res.status}`);
    }
    return res.json();
  },

  async del(path: string): Promise<void> {
    const res = await fetch(`/api${path}`, { method: "DELETE" });
    if (!res.ok) throw new Error(`API error: ${res.status}`);
  },
};

// ─── Types ───────────────────────────────────────

interface User {
  id: string;
  login: string;
  name: string;
  avatarUrl: string;
}

interface PlatformSetupField {
  key: string;
  label: string;
  type: "text" | "password" | "url";
  placeholder?: string;
  help?: string;
}

interface PlatformInfo {
  platform: string;
  displayName: string;
  icon: string;
  description: string;
  docsUrl: string;
  fields: PlatformSetupField[];
  configured: boolean;
}

interface PlatformPublication {
  platform: string;
  status: string;
  publishedAt?: string;
  platformUrl?: string;
  error?: string;
}

interface Publication {
  id: string;
  gistId: string;
  content: {
    meta: {
      title: string;
      type: string;
      platforms: string[];
      tags?: string[];
      draft?: boolean;
    };
    body: string;
  };
  platforms: PlatformPublication[];
  createdAt: string;
  updatedAt: string;
}

// ─── DOM Helpers ─────────────────────────────────

function $(sel: string): HTMLElement {
  return document.querySelector(sel)!;
}

function show(el: HTMLElement) {
  el.hidden = false;
}

function hide(el: HTMLElement) {
  el.hidden = true;
}

function extractGistId(input: string): string {
  const match = input.match(/gist\.github\.com\/[^/]+\/([a-f0-9]+)/);
  if (match) return match[1];
  return input.trim();
}

function escapeHtml(str: string): string {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ─── Auth check + screen switching ───────────────

let currentUser: User | null = null;

async function checkAuth(): Promise<void> {
  try {
    const data = await api.get<{ user: User | null }>("/me");
    currentUser = data.user;
  } catch {
    currentUser = null;
  }

  hide($("#loading-screen"));

  if (currentUser) {
    showDashboard();
  } else {
    showLogin();
  }
}

function showLogin() {
  show($("#login-screen"));
  hide($("#dashboard-screen"));
}

function showDashboard() {
  hide($("#login-screen"));
  show($("#dashboard-screen"));

  // Populate user info
  const avatar = $("#user-avatar") as HTMLImageElement;
  avatar.src = currentUser!.avatarUrl;
  avatar.alt = currentUser!.name;
  $("#user-name").textContent = currentUser!.name;

  // Load data
  loadPlatforms();
  loadStorageStatus();
  loadPublications();
}

// ─── Platform grid ───────────────────────────────

const PLATFORM_ICONS: Record<string, string> = {
  twitter: "𝕏",
  facebook: "📘",
  instagram: "📸",
  linkedin: "💼",
  youtube: "▶️",
  mastodon: "🐘",
  bluesky: "🦋",
  tiktok: "🎵",
  pinterest: "📌",
  threads: "🧵",
  reddit: "🤖",
};

let platformsCache: PlatformInfo[] = [];

async function loadPlatforms(): Promise<void> {
  try {
    const data = await api.get<{ platforms: PlatformInfo[] }>("/platforms");
    platformsCache = data.platforms;
    renderPlatforms();
  } catch {
    $("#platforms-grid").innerHTML =
      '<p class="error">Failed to load platforms</p>';
  }
}

function renderPlatforms(): void {
  const grid = $("#platforms-grid");
  grid.innerHTML = platformsCache
    .map(
      (p) => `
    <div class="platform-card ${p.configured ? "configured" : "unconfigured"}">
      <div class="name">${PLATFORM_ICONS[p.platform] ?? "🌐"} ${escapeHtml(p.displayName)}</div>
      <div class="status">${p.configured ? "✓ Connected" : "Not configured"}</div>
      ${
        p.configured
          ? `<button class="btn-disconnect" data-platform="${p.platform}" data-action="disconnect">Disconnect</button>`
          : `<button class="btn-setup" data-platform="${p.platform}" data-action="setup">Setup</button>`
      }
    </div>
  `,
    )
    .join("");

  // Event delegation
  grid.addEventListener("click", handlePlatformAction);
}

async function handlePlatformAction(e: Event) {
  const btn = (e.target as HTMLElement).closest("[data-action]") as HTMLElement;
  if (!btn) return;

  const platform = btn.dataset.platform!;
  const action = btn.dataset.action;

  if (action === "setup") {
    openSetupWizard(platform);
  } else if (action === "disconnect") {
    if (!confirm(`Disconnect ${platform}? Credentials will be deleted.`)) {
      return;
    }
    try {
      await api.del(`/platforms/${platform}`);
      await loadPlatforms();
    } catch (err) {
      alert(`Failed: ${(err as Error).message}`);
    }
  }
}

// ─── Setup wizard modal ──────────────────────────

async function openSetupWizard(platform: string): Promise<void> {
  const info = platformsCache.find((p) => p.platform === platform);
  if (!info) return;

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal">
      <h3>${escapeHtml(info.displayName)} Setup</h3>
      <p class="modal-desc">${escapeHtml(info.description)}</p>
      <a class="modal-docs" href="${escapeHtml(info.docsUrl)}" target="_blank" rel="noopener">
        📖 View setup instructions →
      </a>
      <form id="setup-form">
        ${info.fields
          .map(
            (f) => `
          <div class="form-group">
            <label for="setup-${f.key}">${escapeHtml(f.label)}</label>
            <input
              type="${f.type}"
              id="setup-${f.key}"
              name="${f.key}"
              placeholder="${escapeHtml(f.placeholder ?? "")}"
              required
            />
            ${f.help ? `<small style="color:var(--text-muted);font-size:0.75rem">${escapeHtml(f.help)}</small>` : ""}
          </div>
        `,
          )
          .join("")}
        <div class="modal-actions">
          <button type="button" class="btn-secondary" id="setup-cancel">Cancel</button>
          <button type="submit" id="setup-save" style="background:var(--primary);color:white">Save</button>
        </div>
      </form>
    </div>
  `;

  document.body.appendChild(overlay);

  // Close on cancel or overlay click
  overlay.querySelector("#setup-cancel")!.addEventListener("click", () => {
    overlay.remove();
  });
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });

  // Submit
  overlay.querySelector("#setup-form")!.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const formData = new FormData(form);
    const body: Record<string, string> = {};
    for (const [k, v] of formData.entries()) {
      body[k] = v as string;
    }

    const saveBtn = overlay.querySelector("#setup-save") as HTMLButtonElement;
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";

    try {
      await api.post(`/platforms/${platform}/setup`, body);
      overlay.remove();
      await loadPlatforms();
    } catch (err) {
      alert(`Setup failed: ${(err as Error).message}`);
      saveBtn.disabled = false;
      saveBtn.textContent = "Save";
    }
  });
}

// ─── Storage status ──────────────────────────────

async function loadStorageStatus(): Promise<void> {
  try {
    const data = await api.get<{ configured: boolean }>("/storage");
    const statusEl = $("#storage-status");
    const setupBtn = $("#storage-setup-btn");

    if (data.configured) {
      statusEl.innerHTML =
        '<span class="storage-configured">✓ S3-compatible storage connected</span>';
      hide(setupBtn);
    } else {
      statusEl.innerHTML =
        '<span class="storage-missing">⚠ No storage configured — required for media uploads</span>';
      show(setupBtn);
    }
  } catch {
    $("#storage-status").textContent = "Failed to check storage";
  }
}

// ─── Publications ────────────────────────────────

async function loadPublications(): Promise<void> {
  try {
    const data = await api.get<{ publications: Publication[] }>(
      "/publications",
    );
    renderPublications(data.publications);
  } catch {
    $("#publications-list").innerHTML =
      '<p class="error">Failed to load publications</p>';
  }
}

function renderPublications(pubs: Publication[]): void {
  const container = $("#publications-list");

  if (pubs.length === 0) {
    container.innerHTML =
      '<p class="empty">No publications yet. Publish a gist to get started!</p>';
    return;
  }

  container.innerHTML = pubs
    .map(
      (pub) => `
    <div class="publication" data-id="${pub.id}">
      <div class="pub-header">
        <div>
          <div class="pub-title">${escapeHtml(pub.content.meta.title)}</div>
          <div class="pub-meta">
            ${pub.content.meta.type} · Gist: ${pub.gistId.slice(0, 8)}…
            · ${timeAgo(pub.createdAt)}
            ${pub.content.meta.draft ? " · <em>Draft</em>" : ""}
          </div>
        </div>
        <div style="display:flex;gap:0.3rem">
          ${
            pub.platforms.some((p) => p.status === "failed")
              ? `<button class="btn-retry" data-pub-retry="${pub.id}">↻ Retry</button>`
              : ""
          }
          <button class="btn-danger" data-pub-delete="${pub.id}">✕</button>
        </div>
      </div>
      <div class="pub-platforms">
        ${pub.platforms
          .map(
            (p) =>
              `<span class="pub-platform-badge ${p.status}" title="${escapeHtml(
                p.error ?? p.platformUrl ?? "",
              )}">
              ${PLATFORM_ICONS[p.platform] ?? ""} ${p.platform} · ${p.status}
            </span>`,
          )
          .join("")}
      </div>
    </div>
  `,
    )
    .join("");
}

// ─── Init ────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  checkAuth();

  // Publish form
  const form = $("#publish-form") as HTMLFormElement;
  const resultEl = $("#publish-result");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = ($("#gist-id") as HTMLInputElement).value;
    const gistId = extractGistId(input);
    const btn = $("#publish-btn") as HTMLButtonElement;

    btn.disabled = true;
    btn.textContent = "Publishing…";
    resultEl.hidden = true;

    try {
      const data = await api.post<{ publication: Publication }>("/publish", {
        gistId,
      });
      const pub = data.publication;
      const succeeded = pub.platforms.filter(
        (p) => p.status === "published",
      ).length;
      const failed = pub.platforms.filter(
        (p) => p.status === "failed",
      ).length;

      resultEl.hidden = false;
      resultEl.className = `result ${failed > 0 ? "error" : "success"}`;
      resultEl.textContent = `Published "${pub.content.meta.title}" — ${succeeded} succeeded, ${failed} failed`;

      await loadPublications();
      form.reset();
    } catch (err) {
      resultEl.hidden = false;
      resultEl.className = "result error";
      resultEl.textContent = (err as Error).message;
    } finally {
      btn.disabled = false;
      btn.textContent = "🚀 Publish";
    }
  });

  // Refresh button
  $("#refresh-btn").addEventListener("click", () => loadPublications());

  // Logout button
  $("#logout-btn").addEventListener("click", async () => {
    await fetch("/auth/logout", { method: "POST" });
    currentUser = null;
    showLogin();
  });

  // Storage setup button
  $("#storage-setup-btn").addEventListener("click", openStorageWizard);

  // Publication actions (event delegation on the list)
  $("#publications-list").addEventListener("click", async (e) => {
    const target = e.target as HTMLElement;

    const deleteBtn = target.closest("[data-pub-delete]") as HTMLElement;
    if (deleteBtn) {
      const id = deleteBtn.dataset.pubDelete!;
      if (!confirm("Delete this publication record?")) return;
      try {
        await api.del(`/publications/${id}`);
        await loadPublications();
      } catch (err) {
        alert(`Delete failed: ${(err as Error).message}`);
      }
      return;
    }

    const retryBtn = target.closest("[data-pub-retry]") as HTMLElement;
    if (retryBtn) {
      const id = retryBtn.dataset.pubRetry!;
      try {
        await api.post(`/publications/${id}/retry`);
        await loadPublications();
      } catch (err) {
        alert(`Retry failed: ${(err as Error).message}`);
      }
    }
  });
});

// ─── Storage wizard ──────────────────────────────

function openStorageWizard(): void {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal">
      <h3>S3-Compatible Storage</h3>
      <p class="modal-desc">
        Configure an S3-compatible storage service for media uploads.
        Works with AWS S3, Backblaze B2, Cloudflare R2, MinIO, etc.
      </p>
      <form id="storage-form">
        <div class="form-group">
          <label for="s3-endpoint">Endpoint URL</label>
          <input type="url" id="s3-endpoint" name="endpoint" placeholder="https://s3.us-east-005.backblazeb2.com" required />
        </div>
        <div class="form-group">
          <label for="s3-region">Region</label>
          <input type="text" id="s3-region" name="region" placeholder="us-east-005" required />
        </div>
        <div class="form-group">
          <label for="s3-bucket">Bucket Name</label>
          <input type="text" id="s3-bucket" name="bucket" placeholder="my-social-media" required />
        </div>
        <div class="form-group">
          <label for="s3-key">Access Key ID</label>
          <input type="text" id="s3-key" name="accessKeyId" placeholder="AKIA..." required />
        </div>
        <div class="form-group">
          <label for="s3-secret">Secret Access Key</label>
          <input type="password" id="s3-secret" name="secretAccessKey" placeholder="••••••••" required />
        </div>
        <div class="modal-actions">
          <button type="button" class="btn-secondary" id="storage-cancel">Cancel</button>
          <button type="submit" id="storage-save" style="background:var(--primary);color:white">Save</button>
        </div>
      </form>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.querySelector("#storage-cancel")!.addEventListener("click", () => {
    overlay.remove();
  });
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });

  overlay.querySelector("#storage-form")!.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const formData = new FormData(form);
    const body: Record<string, string> = {};
    for (const [k, v] of formData.entries()) {
      body[k] = v as string;
    }

    const saveBtn = overlay.querySelector("#storage-save") as HTMLButtonElement;
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";

    try {
      await api.post("/storage", body);
      overlay.remove();
      await loadStorageStatus();
    } catch (err) {
      alert(`Failed: ${(err as Error).message}`);
      saveBtn.disabled = false;
      saveBtn.textContent = "Save";
    }
  });
}
