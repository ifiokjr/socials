import { icon, ICON_COLORS } from "./icons.ts";

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

interface User { id: string; login: string; name: string; avatarUrl: string; }

interface PlatformSetupField {
  key: string; label: string; type: "text" | "password" | "url";
  placeholder?: string; help?: string;
}

interface PlatformInfo {
  platform: string; displayName: string; icon: string; description: string;
  docsUrl: string; fields: PlatformSetupField[]; configured: boolean;
}

interface PlatformPublication {
  platform: string; status: string; publishedAt?: string;
  platformUrl?: string; error?: string;
}

interface Publication {
  id: string; gistId: string;
  content: { meta: { title: string; type: string; platforms: string[]; tags?: string[]; draft?: boolean; }; body: string; };
  platforms: PlatformPublication[]; createdAt: string; updatedAt: string;
}

// ─── DOM Helpers ─────────────────────────────────

function $(sel: string): HTMLElement { return document.querySelector(sel)!; }
function show(el: HTMLElement) { el.hidden = false; }
function hide(el: HTMLElement) { el.hidden = true; }

function extractGistId(input: string): string {
  const m = input.match(/gist\.github\.com\/[^/]+\/([a-f0-9]+)/);
  return m ? m[1] : input.trim();
}

function escapeHtml(s: string): string {
  const d = document.createElement("div"); d.textContent = s; return d.innerHTML;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ─── Theme toggle ────────────────────────────────

function initTheme() {
  const saved = localStorage.getItem("theme");
  const prefersDark = globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches;
  const isDark = saved ? saved === "dark" : prefersDark !== false;
  applyTheme(isDark);
}

function applyTheme(dark: boolean) {
  const root = document.documentElement;
  if (dark) {
    root.classList.remove("light");
  } else {
    root.classList.add("light");
  }
  updateThemeIcon(dark);
  localStorage.setItem("theme", dark ? "dark" : "light");
}

function updateThemeIcon(dark: boolean) {
  // Update both dashboard and login theme icons
  for (const prefix of ["theme", "login-theme"]) {
    const sunIcon = document.getElementById(`${prefix}-icon-dark`);
    const moonIcon = document.getElementById(`${prefix}-icon-light`);
    if (sunIcon && moonIcon) {
      sunIcon.classList.toggle("hidden", !dark);
      moonIcon.classList.toggle("hidden", dark);
    }
  }
}

function toggleTheme() {
  const isDark = !document.documentElement.classList.contains("light");
  applyTheme(!isDark);
}

// ─── Auth + screens ──────────────────────────────

let currentUser: User | null = null;

async function checkAuth(): Promise<void> {
  try {
    currentUser = (await api.get<{ user: User | null }>("/me")).user;
  } catch { currentUser = null; }
  hide($("#loading-screen"));
  if (currentUser) showDashboard(); else showLogin();
}

const PLATFORM_NAMES: Record<string, string> = {
  twitter: "X (Twitter)", facebook: "Facebook", instagram: "Instagram",
  linkedin: "LinkedIn", youtube: "YouTube", mastodon: "Mastodon",
  bluesky: "Bluesky", tiktok: "TikTok", pinterest: "Pinterest",
  threads: "Threads", reddit: "Reddit",
};

function showLogin() {
  show($("#login-screen"));
  hide($("#dashboard-screen"));
  const container = $("#login-platforms");
  if (container && !container.hasChildNodes()) {
    const platforms = ["twitter","facebook","instagram","linkedin","youtube","mastodon","bluesky","tiktok","pinterest","threads","reddit"];
    container.innerHTML = platforms.map(p =>
      `<span title="${PLATFORM_NAMES[p] ?? p}"
            class="w-11 h-11 flex items-center justify-center rounded-xl bg-surface-900 light:bg-surface-100 border border-surface-800 light:border-surface-300 transition-all duration-200 hover:scale-110 hover:border-surface-600 light:hover:border-surface-400">
        ${icon(p, 18, ICON_COLORS[p] ?? "#fff")}
      </span>`
    ).join("");
  }
}

function showDashboard() {
  hide($("#login-screen"));
  show($("#dashboard-screen"));
  const av = $("#user-avatar") as HTMLImageElement;
  av.src = currentUser!.avatarUrl; av.alt = currentUser!.name;
  $("#user-name").textContent = currentUser!.name;
  loadPlatforms(); loadStorageStatus(); loadPublications();
}

// ─── Platform grid ───────────────────────────────

let platformsCache: PlatformInfo[] = [];

async function loadPlatforms(): Promise<void> {
  try {
    platformsCache = (await api.get<{ platforms: PlatformInfo[] }>("/platforms")).platforms;
    renderPlatforms();
  } catch { $("#platforms-grid").innerHTML = '<p class="text-sm text-negative col-span-full text-center py-4">Failed to load</p>'; }
}

function renderPlatforms(): void {
  const grid = $("#platforms-grid");
  grid.innerHTML = platformsCache.map(p => `
    <div class="group relative flex flex-col items-center gap-2 rounded-xl p-4 transition-all duration-200
      ${p.configured
        ? "bg-positive/8 border border-positive/25 light:bg-positive/5 light:border-positive/20"
        : "bg-surface-900/50 border border-surface-800 light:bg-surface-100 light:border-surface-300 hover:border-surface-600 light:hover:border-surface-400"}">
      <div class="flex items-center gap-2 text-sm font-medium text-surface-200 light:text-surface-700">
        ${icon(p.platform, 18, ICON_COLORS[p.platform] ?? "currentColor")}
        <span>${escapeHtml(p.displayName)}</span>
      </div>
      <span class="text-[0.7rem] font-medium tracking-wide uppercase ${p.configured ? "text-positive" : "text-surface-500"}">
        ${p.configured ? "Connected" : "Not set up"}
      </span>
      <button data-platform="${p.platform}" data-action="${p.configured ? "disconnect" : "setup"}"
        class="mt-1 text-[0.7rem] font-semibold rounded-md px-3 py-1 transition-colors
        ${p.configured
          ? "text-negative/80 hover:text-negative hover:bg-negative/10 border border-transparent hover:border-negative/20"
          : "text-accent hover:text-white hover:bg-accent border border-accent/30 hover:border-accent"}">
        ${p.configured ? "Disconnect" : "Setup"}
      </button>
    </div>
  `).join("");
  grid.addEventListener("click", handlePlatformAction);
}

async function handlePlatformAction(e: Event) {
  const btn = (e.target as HTMLElement).closest("[data-action]") as HTMLElement;
  if (!btn) return;
  const platform = btn.dataset.platform!;
  if (btn.dataset.action === "setup") { openSetupWizard(platform); }
  else if (btn.dataset.action === "disconnect") {
    if (!confirm(`Disconnect ${platform}? Credentials will be deleted.`)) return;
    try { await api.del(`/platforms/${platform}`); await loadPlatforms(); }
    catch (err) { alert(`Failed: ${(err as Error).message}`); }
  }
}

// ─── Setup wizard modal ──────────────────────────

function openSetupWizard(platform: string): void {
  const info = platformsCache.find(p => p.platform === platform);
  if (!info) return;

  const overlay = document.createElement("div");
  overlay.className = "fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in";
  overlay.innerHTML = `
    <div class="glass-card w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 animate-slide-up">
      <div class="flex items-center gap-3 mb-4">
        ${icon(platform, 22, ICON_COLORS[platform] ?? "currentColor")}
        <h3 class="font-display text-lg font-bold text-surface-100 light:text-surface-900">${escapeHtml(info.displayName)} Setup</h3>
      </div>
      <p class="text-sm text-surface-400 mb-3">${escapeHtml(info.description)}</p>
      <a href="${escapeHtml(info.docsUrl)}" target="_blank" rel="noopener"
         class="inline-flex items-center gap-1 text-xs text-accent hover:text-accent-hover font-medium mb-5 transition-colors">
        View setup instructions ↗
      </a>
      <form id="setup-form" class="space-y-4">
        ${info.fields.map(f => `
          <div>
            <label for="setup-${f.key}" class="block text-xs font-medium text-surface-400 light:text-surface-500 mb-1.5">${escapeHtml(f.label)}</label>
            <input type="${f.type}" id="setup-${f.key}" name="${f.key}" class="input-field" placeholder="${escapeHtml(f.placeholder ?? "")}" required />
            ${f.help ? `<p class="mt-1 text-[0.7rem] text-surface-500">${escapeHtml(f.help)}</p>` : ""}
          </div>
        `).join("")}
        <div class="flex gap-3 pt-2">
          <button type="button" id="setup-cancel" class="flex-1 rounded-lg border border-surface-700 light:border-surface-300 py-2.5 text-sm font-medium text-surface-400 hover:text-surface-200 light:hover:text-surface-700 hover:bg-surface-800 light:hover:bg-surface-200 transition-colors">Cancel</button>
          <button type="submit" id="setup-save" class="flex-1 rounded-lg bg-accent hover:bg-accent-hover text-white py-2.5 text-sm font-semibold transition-colors">Save</button>
        </div>
      </form>
    </div>`;

  document.body.appendChild(overlay);
  overlay.querySelector("#setup-cancel")!.addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelector("#setup-form")!.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target as HTMLFormElement);
    const body: Record<string, string> = {};
    for (const [k, v] of fd.entries()) body[k] = v as string;
    const btn = overlay.querySelector("#setup-save") as HTMLButtonElement;
    btn.disabled = true; btn.textContent = "Saving…";
    try { await api.post(`/platforms/${platform}/setup`, body); overlay.remove(); await loadPlatforms(); }
    catch (err) { alert(`Setup failed: ${(err as Error).message}`); btn.disabled = false; btn.textContent = "Save"; }
  });
}

// ─── Storage ─────────────────────────────────────

async function loadStorageStatus(): Promise<void> {
  try {
    const { configured } = await api.get<{ configured: boolean }>("/storage");
    const el = $("#storage-status");
    const btn = $("#storage-setup-btn");
    if (configured) {
      el.innerHTML = `<span class="text-positive font-medium">✓ S3-compatible storage connected</span>`;
      hide(btn);
    } else {
      el.innerHTML = `<span class="text-caution font-medium">⚠ No storage configured — required for media uploads</span>`;
      show(btn);
    }
  } catch { $("#storage-status").textContent = "Failed to check storage"; }
}

function openStorageWizard(): void {
  const overlay = document.createElement("div");
  overlay.className = "fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in";
  const fields = [
    { key: "endpoint", label: "Endpoint URL", type: "url", ph: "https://s3.us-east-005.backblazeb2.com" },
    { key: "region", label: "Region", type: "text", ph: "us-east-005" },
    { key: "bucket", label: "Bucket Name", type: "text", ph: "my-social-media" },
    { key: "accessKeyId", label: "Access Key ID", type: "text", ph: "AKIA..." },
    { key: "secretAccessKey", label: "Secret Access Key", type: "password", ph: "••••••••" },
  ];
  overlay.innerHTML = `
    <div class="glass-card w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 animate-slide-up">
      <h3 class="font-display text-lg font-bold text-surface-100 light:text-surface-900 mb-2">S3-Compatible Storage</h3>
      <p class="text-sm text-surface-400 mb-5">Works with AWS S3, Backblaze B2, Cloudflare R2, MinIO, etc.</p>
      <form id="storage-form" class="space-y-4">
        ${fields.map(f => `
          <div>
            <label for="s3-${f.key}" class="block text-xs font-medium text-surface-400 light:text-surface-500 mb-1.5">${f.label}</label>
            <input type="${f.type}" id="s3-${f.key}" name="${f.key}" class="input-field" placeholder="${f.ph}" required />
          </div>
        `).join("")}
        <div class="flex gap-3 pt-2">
          <button type="button" id="storage-cancel" class="flex-1 rounded-lg border border-surface-700 light:border-surface-300 py-2.5 text-sm font-medium text-surface-400 hover:text-surface-200 light:hover:text-surface-700 hover:bg-surface-800 light:hover:bg-surface-200 transition-colors">Cancel</button>
          <button type="submit" id="storage-save" class="flex-1 rounded-lg bg-accent hover:bg-accent-hover text-white py-2.5 text-sm font-semibold transition-colors">Save</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector("#storage-cancel")!.addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector("#storage-form")!.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target as HTMLFormElement);
    const body: Record<string, string> = {};
    for (const [k, v] of fd.entries()) body[k] = v as string;
    const btn = overlay.querySelector("#storage-save") as HTMLButtonElement;
    btn.disabled = true; btn.textContent = "Saving…";
    try { await api.post("/storage", body); overlay.remove(); await loadStorageStatus(); }
    catch (err) { alert(`Failed: ${(err as Error).message}`); btn.disabled = false; btn.textContent = "Save"; }
  });
}

// ─── Publications ────────────────────────────────

async function loadPublications(): Promise<void> {
  try {
    const { publications } = await api.get<{ publications: Publication[] }>("/publications");
    renderPublications(publications);
  } catch { $("#publications-list").innerHTML = '<p class="text-sm text-negative text-center py-4">Failed to load</p>'; }
}

function renderPublications(pubs: Publication[]): void {
  const container = $("#publications-list");
  if (pubs.length === 0) {
    container.innerHTML = `<p class="text-sm text-surface-500 text-center py-10 italic">No publications yet. Paste a Gist ID above to get started.</p>`;
    return;
  }
  container.innerHTML = `<div class="space-y-3">${pubs.map(pub => `
    <div class="rounded-xl border border-surface-800 light:border-surface-200 bg-surface-900/40 light:bg-surface-100/60 p-4 transition-colors" data-id="${pub.id}">
      <div class="flex items-start justify-between gap-3 mb-3">
        <div class="min-w-0">
          <h3 class="text-sm font-semibold text-surface-100 light:text-surface-800 truncate">${escapeHtml(pub.content.meta.title)}</h3>
          <p class="text-[0.7rem] text-surface-500 mt-0.5 font-mono">
            ${pub.content.meta.type} · ${pub.gistId.slice(0, 8)}… · ${timeAgo(pub.createdAt)}
            ${pub.content.meta.draft ? " · <em>Draft</em>" : ""}
          </p>
        </div>
        <div class="flex gap-1.5 shrink-0">
          ${pub.platforms.some(p => p.status === "failed")
            ? `<button data-pub-retry="${pub.id}" class="text-[0.7rem] font-semibold text-caution hover:bg-caution/10 rounded-md px-2 py-1 transition-colors">Retry</button>` : ""}
          <button data-pub-delete="${pub.id}" class="text-[0.7rem] font-semibold text-surface-500 hover:text-negative hover:bg-negative/10 rounded-md px-2 py-1 transition-colors">✕</button>
        </div>
      </div>
      <div class="flex flex-wrap gap-1.5">
        ${pub.platforms.map(p => {
          const color = p.status === "published" ? "text-positive bg-positive/10" :
                        p.status === "failed" ? "text-negative bg-negative/10" :
                        "text-caution bg-caution/10";
          return `<span class="badge ${color}" title="${escapeHtml(p.error ?? p.platformUrl ?? "")}">
            ${icon(p.platform, 11, "currentColor")} ${p.platform} · ${p.status}
          </span>`;
        }).join("")}
      </div>
    </div>
  `).join("")}</div>`;
}

// ─── Init ────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  checkAuth();

  // Theme toggles (both login and dashboard)
  $("#theme-toggle").addEventListener("click", toggleTheme);
  $("#login-theme-toggle").addEventListener("click", toggleTheme);

  // Publish form
  const form = $("#publish-form") as HTMLFormElement;
  const resultEl = $("#publish-result");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const gistId = extractGistId(($("#gist-id") as HTMLInputElement).value);
    const btn = $("#publish-btn") as HTMLButtonElement;
    btn.disabled = true; btn.textContent = "Publishing…"; resultEl.hidden = true;
    try {
      const { publication: pub } = await api.post<{ publication: Publication }>("/publish", { gistId });
      const ok = pub.platforms.filter(p => p.status === "published").length;
      const fail = pub.platforms.filter(p => p.status === "failed").length;
      resultEl.hidden = false;
      resultEl.className = `mt-4 rounded-lg px-4 py-3 text-sm font-medium ${fail > 0 ? "bg-negative/10 text-negative border border-negative/20" : "bg-positive/10 text-positive border border-positive/20"}`;
      resultEl.textContent = `Published "${pub.content.meta.title}" — ${ok} succeeded, ${fail} failed`;
      await loadPublications(); form.reset();
    } catch (err) {
      resultEl.hidden = false;
      resultEl.className = "mt-4 rounded-lg px-4 py-3 text-sm font-medium bg-negative/10 text-negative border border-negative/20";
      resultEl.textContent = (err as Error).message;
    } finally { btn.disabled = false; btn.textContent = "Publish"; }
  });

  // Refresh
  $("#refresh-btn").addEventListener("click", () => loadPublications());

  // Logout
  $("#logout-btn").addEventListener("click", async () => {
    await fetch("/auth/logout", { method: "POST" });
    currentUser = null; showLogin();
  });

  // Storage
  $("#storage-setup-btn").addEventListener("click", openStorageWizard);

  // Publication actions (delegation)
  $("#publications-list").addEventListener("click", async (e) => {
    const del = (e.target as HTMLElement).closest("[data-pub-delete]") as HTMLElement;
    if (del) {
      if (!confirm("Delete this publication record?")) return;
      try { await api.del(`/publications/${del.dataset.pubDelete!}`); await loadPublications(); }
      catch (err) { alert(`Delete failed: ${(err as Error).message}`); }
      return;
    }
    const retry = (e.target as HTMLElement).closest("[data-pub-retry]") as HTMLElement;
    if (retry) {
      try { await api.post(`/publications/${retry.dataset.pubRetry!}/retry`); await loadPublications(); }
      catch (err) { alert(`Retry failed: ${(err as Error).message}`); }
    }
  });
});
