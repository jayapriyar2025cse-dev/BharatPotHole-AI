/* ════════════════════════════════════════════════════════════
   Urban Intelligence — Dashboard
   Vanilla JavaScript controller for the existing Node.js backend
   and FastAPI YOLO AI service. No frameworks, no build step.

   Backend contract (verified, unchanged):
     GET  /health                  → { status, aiServiceEnabled }
     POST /api/auth/login          → { data: { token, user } }
     GET  /api/auth/me             → { data: { user } }
     GET  /api/dashboard/stats     → { data: { stats } }
     GET  /api/dashboard/recent    → { data: { detections } }
     POST /api/detections/analyze  → { data: { detection } }   (multipart)
     GET  /api/detections          → { data: { detections, pagination } }
     DELETE /api/detections/:id    → role-based deletion (ADMIN any · DRIVER own · ANALYST forbidden)
   ════════════════════════════════════════════════════════════ */

"use strict";

/* ─── Configuration ─── */
const API_BASE = "http://localhost:5000";
const TOKEN_KEY = "bharatpothole_token";
const USER_KEY = "bharatpothole_user";
const HEALTH_POLL_MS = 30000;
const DEFAULT_LOGIN_SUB = "AI-Powered Mobile Urban Intelligence Platform using Public Transport Fleet";

/* ─── Application state (single source of truth) ─── */
const state = {
  token: localStorage.getItem(TOKEN_KEY) || null,
  user: null,
  file: null,          // currently selected image File
  previewUrl: null,    // object URL for the selected image
  backendOnline: false,
  aiEnabled: false,
  lastConfidence: null, // confidence of this session's latest analysis
  pendingAnalysis: false, // run analysis right after login
  statsLoaded: false,
};

/* ─── Tiny DOM helpers ─── */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

/** Escape untrusted strings before inserting them as HTML. */
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

/** Format a confidence value (0–1) as a percentage, e.g. 0.317 → "31.7%". */
function formatPercent(value) {
  if (value === null || value === undefined || value === "" || isNaN(value)) return "—";
  const n = Number(value);
  const pct = n > 1 ? n : n * 100; // tolerate percentages already > 1
  return `${pct.toFixed(1)}%`;
}

/** Format an ISO timestamp for display. */
function formatDate(value, compact = false) {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "—";
  return compact
    ? d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : d.toLocaleString();
}

/** Human-friendly file size. */
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Initials for avatars: "Ravi Kumar" → "RK" */
function initialsOf(name, email) {
  const source = (name || email || "?").trim();
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return (parts[0]?.[0] || "?").toUpperCase() + (parts[1]?.[0] || "").toUpperCase();
}

/* ══════════════ TOAST NOTIFICATIONS ══════════════
   Elegant, non-technical error/success messages for the user. */
const TOAST_ICONS = { success: "#i-check-circle", error: "#i-alert", info: "#i-info" };

function showToast(type, title, message) {
  const container = $("#toastContainer");
  if (!container) return;
  while (container.children.length >= 4) container.removeChild(container.firstElementChild);

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <svg class="icon"><use href="${TOAST_ICONS[type] || TOAST_ICONS.info}"></use></svg>
    <div class="toast-body">
      <p class="toast-title">${escapeHtml(title)}</p>
      ${message ? `<p class="toast-message">${escapeHtml(message)}</p>` : ""}
    </div>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("leaving");
    setTimeout(() => toast.remove(), 320);
  }, 4600);
}

/* ══════════════ API LAYER ══════════════ */
class ApiError extends Error {
  constructor(message, kind = "api") {
    super(message);
    this.kind = kind; // 'network' | 'auth' | 'api'
  }
}

/**
 * Fetch wrapper: attaches the Bearer token, parses the standard
 * { success, message, data } envelope and converts every failure into
 * a friendly ApiError — raw JS errors never reach the UI.
 */
async function apiFetch(path, options = {}) {
  const { method = "GET", body = null, isForm = false, suppressAuthHandler = false } = options;

  const headers = {};
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  // NOTE: when sending FormData we must NOT set Content-Type manually.
  if (body && !isForm) headers["Content-Type"] = "application/json";

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: isForm ? body : body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(
      "Cannot reach the server. Please make sure the backend is running on http://localhost:5000.",
      "network"
    );
  }

  let payload = null;
  try { payload = await res.json(); } catch { /* non-JSON response body */ }

  if (!res.ok) {
    const serverMessage = payload && payload.message;

    // Invalid/expired token on a protected route → clear session gracefully
    if (res.status === 401 && !suppressAuthHandler) {
      handleSessionExpired(serverMessage);
      throw new ApiError(serverMessage || "Your session has expired. Please sign in again.", "auth");
    }

    const friendly =
      res.status === 401 ? (serverMessage || "Invalid email or password.")
      : res.status === 404 ? (serverMessage || "The requested endpoint was not found.")
      : res.status >= 500 ? (serverMessage || "The server encountered an error. Please try again.")
      : serverMessage || `Request failed (HTTP ${res.status}).`;
    throw new ApiError(friendly, "api");
  }

  return payload;
}

/* ══════════════ SYSTEM HEALTH (real data only) ══════════════ */
function setDot(el, cls) {
  if (el) el.className = `status-dot ${cls}`;
}

function setAnalysisBadge(text, cls) {
  const badge = $("#analysisModeBadge");
  if (badge) {
    badge.textContent = text;
    badge.className = `badge ${cls}`;
  }
}

/** Poll GET /health → drives the backend + AI status indicators. */
async function checkHealth() {
  setDot($("#backendDot"), "is-checking");
  setDot($("#aiDot"), "is-checking");
  setDot($("#sideAiDot"), "is-checking");

  try {
    const res = await fetch(`${API_BASE}/health`, { cache: "no-store" });
    if (!res.ok) throw new Error("health check failed");
    const data = await res.json();

    state.backendOnline = true;
    state.aiEnabled = Boolean(data.aiServiceEnabled);

    setDot($("#backendDot"), "is-ok");
    $("#backendLabel").textContent = "Online";

    if (state.aiEnabled) {
      setDot($("#aiDot"), "is-ok");
      $("#aiLabel").textContent = "Online";
      setDot($("#sideAiDot"), "is-ok");
      $("#sideAiLabel").textContent = "YOLO Model Active";
      setAnalysisBadge("AI: YOLO Active", "badge-accent");
    } else {
      setDot($("#aiDot"), "is-warn");
      $("#aiLabel").textContent = "Mock";
      setDot($("#sideAiDot"), "is-warn");
      $("#sideAiLabel").textContent = "Mock Service";
      setAnalysisBadge("AI: Mock Mode", "badge-warn");
    }
  } catch {
    // Backend unreachable → everything downstream is unavailable. No fake status.
    state.backendOnline = false;
    state.aiEnabled = false;
    setDot($("#backendDot"), "is-off");
    $("#backendLabel").textContent = "Offline";
    setDot($("#aiDot"), "is-off");
    $("#aiLabel").textContent = "Offline";
    setDot($("#sideAiDot"), "is-off");
    $("#sideAiLabel").textContent = "Offline";
    setAnalysisBadge("Backend Offline", "badge-danger");
  }
}

/* ══════════════ AUTHENTICATION ══════════════ */
function setAuthButton(button, signedIn) {
  if (!button) return;
  button.innerHTML = signedIn
    ? `<svg class="icon"><use href="#i-logout"></use></svg><span>Logout</span>`
    : `<svg class="icon"><use href="#i-login"></use></svg><span>Sign in</span>`;
}

/** Re-render every piece of UI that depends on the session. */
function renderAuthUI() {
  const signedIn = Boolean(state.token);
  const name = state.user?.name || state.user?.email || "Signed in";
  const email = state.user?.email || "";
  const role = state.user?.role
    ? state.user.role.charAt(0) + state.user.role.slice(1).toLowerCase()
    : (signedIn ? "Member" : "Not signed in");

  // Top-right profile
  $("#profileName").textContent = signedIn ? name : "Guest";
  $("#profileRole").textContent = signedIn ? role : "Not signed in";
  $("#profileAvatar").textContent = signedIn ? initialsOf(name, email) : "?";
  setAuthButton($("#profileAuthBtn"), signedIn);

  // Sidebar footer
  $("#sideUserName").textContent = signedIn ? name : "Not signed in";
  $("#sideUserEmail").textContent = signedIn ? email : "Sign in to analyse roads";
  $("#sideAvatar").textContent = signedIn ? initialsOf(name, email) : "?";
  setAuthButton($("#sideAuthBtn"), signedIn);

  // Contextual hints
  $("#statsHint").hidden = signedIn;
  $("#authNote").hidden = signedIn;
}

/* The login page doubles as the authentication gate: while it is open,
   `html.auth-gate` hides the entire dashboard shell (see style.css). */
function openLoginModal(reason) {
  $("#loginSubtitle").textContent = reason || DEFAULT_LOGIN_SUB;
  $("#loginError").hidden = true;
  document.documentElement.classList.add("auth-gate");
  $("#loginModal").hidden = false;
  setTimeout(() => $("#loginEmail")?.focus(), 60);
}

function closeLoginModal() {
  $("#loginModal").hidden = true;
  document.documentElement.classList.remove("auth-gate");
}

function isLoginGateOpen() {
  return document.documentElement.classList.contains("auth-gate");
}

/** Clear the stored session and refresh dependent UI. */
function clearSession() {
  state.token = null;
  state.user = null;
  state.statsLoaded = false;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  renderAuthUI();
  resetStatsCards();
}

/** Called when a protected route answers 401. */
function handleSessionExpired(serverMessage) {
  const hadSession = Boolean(state.token);
  clearSession();
  // Unauthenticated users always land back on the login page.
  openLoginModal(hadSession ? "Your session has expired. Please sign in again." : undefined);
  if (hadSession) {
    showToast("error", "Session expired", serverMessage || "Please sign in again to continue.");
  }
}

/** POST /api/auth/login → save data.token in localStorage. */
async function handleLoginSubmit(event) {
  event.preventDefault();
  const email = $("#loginEmail").value.trim();
  const password = $("#loginPassword").value;
  const errorBox = $("#loginError");

  if (!email || !password) {
    errorBox.hidden = false;
    errorBox.querySelector("span").textContent = "Please enter your email and password.";
    return;
  }

  setLoginLoading(true);
  errorBox.hidden = true;

  try {
    const json = await apiFetch("/api/auth/login", {
      method: "POST",
      body: { email, password },
      suppressAuthHandler: true,
    });

    const token = json?.data?.token;
    const user = json?.data?.user || null;
    if (!token) throw new ApiError("The server did not return a session token.", "api");

    state.token = token;
    state.user = user;
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));

    renderAuthUI();
    closeLoginModal();
    $("#loginForm").reset();
    showToast("success", "Signed in", `Welcome back${user?.name ? `, ${user.name}` : ""}.`);

    // Login page → authenticated Dashboard always lands on Overview.
    if (state.currentView === "overview") {
      loadStats();
      loadConfidenceCard();
    } else {
      switchView("overview"); // lazy-loads stats + confidence card
    }

    // Resume any analysis the user attempted before signing in
    if (state.pendingAnalysis) {
      state.pendingAnalysis = false;
      setTimeout(runAnalysis, 400);
    }
  } catch (error) {
    errorBox.hidden = false;
    errorBox.querySelector("span").textContent =
      error instanceof ApiError ? error.message : "Sign in failed. Please try again.";
  } finally {
    setLoginLoading(false);
  }
}

function setLoginLoading(loading) {
  $("#loginBtn").disabled = loading;
  $("#loginBtnText").textContent = loading ? "Signing in…" : "Sign in";
  $("#loginSpinner").hidden = !loading;
}

function handleLogout() {
  clearSession();
  $("#resultCard").hidden = true;
  if (state.currentView === "history") renderHistoryGate();
  openLoginModal(); // logout always returns to the login page
  showToast("info", "Signed out", "You have been logged out of the dashboard.");
}

/** Restore a saved session and verify it with GET /api/auth/me. */
async function restoreSession() {
  if (!state.token) return;

  try {
    const stored = JSON.parse(localStorage.getItem(USER_KEY) || "null");
    if (stored) state.user = stored;
  } catch { state.user = null; }
  renderAuthUI();

  try {
    const json = await apiFetch("/api/auth/me");
    state.user = json?.data?.user || state.user;
    localStorage.setItem(USER_KEY, JSON.stringify(state.user));
    renderAuthUI();
    loadStats();
    loadConfidenceCard();
  } catch (error) {
    // 'auth' errors were already handled inside apiFetch; transient network
    // errors keep the token so the user can retry later.
    if (error instanceof ApiError && error.kind === "network") {
      showToast("info", "Backend offline", "Live data will load once the backend is reachable.");
    }
  }
}

/* ══════════════ NAVIGATION / VIEWS ══════════════ */
state.currentView = "overview";

/**
 * The analysis workspace exists ONCE and is moved between the
 * Overview and Detect Pothole views — no duplicated DOM or IDs.
 */
function mountWorkspace(viewName) {
  const slot = document.querySelector(`[data-workspace-slot="${viewName}"]`);
  const workspace = $("#analysisWorkspace");
  if (slot && workspace && workspace.parentElement !== slot) {
    slot.appendChild(workspace);
  }
}

function switchView(viewName) {
  state.currentView = viewName;

  // Toggle view sections
  $$(".view").forEach((view) => {
    const isActive = view.dataset.view === viewName;
    view.classList.toggle("active", isActive);
    view.hidden = !isActive;
  });

  // Toggle nav highlight
  $$(".nav-item").forEach((item) => {
    const isActive = item.dataset.view === viewName;
    item.classList.toggle("active", isActive);
    if (isActive) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  });

  mountWorkspace(viewName);

  // Lazy-load data for the view that is being opened
  if (viewName === "history") {
    state.token ? loadHistory() : renderHistoryGate();
  }
  if (viewName === "intelligence") {
    state.token ? loadIntelligence() : setIntelSection("empty");
  }
  if (viewName === "reports") {
    state.token ? loadReports() : setReportSection("empty");
  }
  if (viewName === "overview" && state.token && !state.statsLoaded) {
    loadStats();
    loadConfidenceCard();
  }

  closeSidebar();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ─── Collapsible sidebar (tablet & mobile) ─── */
function openSidebar() {
  $("#sidebar").classList.add("open");
  $("#sidebarOverlay").hidden = false;
}
function closeSidebar() {
  $("#sidebar").classList.remove("open");
  $("#sidebarOverlay").hidden = true;
}

/* ══════════════ OVERVIEW STATISTICS ══════════════ */
function animateNumber(el, target, suffix = "") {
  const duration = 700;
  const start = performance.now();
  const from = 0;

  function frame(now) {
    const t = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
    const value = Math.round(from + (target - from) * eased);
    el.textContent = `${value}${suffix}`;
    if (t < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function resetStatsCards() {
  ["#statTotal", "#statPotholes", "#statCritical", "#statConfidence"].forEach((id) => {
    $(id).textContent = "--";
  });
  $("#statTotalSub").textContent = "Awaiting live data";
  $("#statPotholesSub").textContent = "Awaiting live data";
  $("#statCriticalSub").textContent = "Awaiting live data";
  $("#statConfidenceSub").textContent = "Awaiting live data";
  state.lastConfidence = null;
}

/** GET /api/dashboard/stats → real overview card values (never faked). */
async function loadStats() {
  if (!state.token) {
    resetStatsCards();
    $("#statsHint").hidden = false;
    return;
  }

  try {
    const json = await apiFetch("/api/dashboard/stats");
    const stats = json?.data?.stats;
    if (!stats) return;

    animateNumber($("#statTotal"), stats.totalDetections ?? 0);
    animateNumber($("#statPotholes"), stats.totalPotholes ?? 0);
    animateNumber($("#statCritical"), stats.bySeverity?.critical ?? 0);
    $("#statTotalSub").textContent = "All recorded scans";
    $("#statPotholesSub").textContent = "Individual defects found";
    $("#statCriticalSub").textContent = "Require immediate attention";
    $("#statsHint").hidden = true;
    state.statsLoaded = true;
  } catch (error) {
    // Silent failure — the status chips already communicate backend state.
    $("#statTotalSub").textContent = "Unavailable — check connection";
    $("#statPotholesSub").textContent = "Unavailable — check connection";
    $("#statCriticalSub").textContent = "Unavailable — check connection";
    if (error instanceof ApiError && error.kind === "network") state.statsLoaded = false;
  }
}

/**
 * AI Confidence card — only real data:
 *  · the latest analysis of this session, otherwise
 *  · the average confidence of recent positive detections, otherwise "--".
 */
async function loadConfidenceCard() {
  if (state.lastConfidence !== null && state.lastConfidence !== undefined) {
    $("#statConfidence").textContent = formatPercent(state.lastConfidence);
    $("#statConfidenceSub").textContent = "Based on your last analysis";
    return;
  }

  if (!state.token) {
    $("#statConfidence").textContent = "--";
    $("#statConfidenceSub").textContent = "Awaiting live data";
    return;
  }

  try {
    const json = await apiFetch("/api/dashboard/recent?limit=20");
    const detections = json?.data?.detections || [];
    const positive = detections.filter((d) => d.potholeDetected && d.confidence !== null && d.confidence !== undefined);
    const average = positive.length
      ? positive.reduce((sum, d) => sum + Number(d.confidence), 0) / positive.length
      : null;

    if (average === null) {
      $("#statConfidence").textContent = "--";
      $("#statConfidenceSub").textContent = "No positive detections yet";
      return;
    }
    $("#statConfidence").textContent = formatPercent(average);
    $("#statConfidenceSub").textContent = `Average of ${positive.length} recent scan${positive.length === 1 ? "" : "s"}`;
  } catch {
    // Keep whatever is currently displayed; never invent a number.
  }
}

/* ══════════════ IMAGE UPLOAD ══════════════ */
const ALLOWED_TYPES = ["image/jpeg", "image/jpg", "image/png"];
const MAX_FILE_BYTES = 10 * 1024 * 1024; // backend limit: 10 MB

function showImageError(message) {
  const box = $("#imageError");
  box.textContent = message || "";
  box.hidden = !message;
}
function showLocationError(message) {
  const box = $("#locationError");
  box.textContent = message || "";
  box.hidden = !message;
}

/** Validate type + size against the backend's multer rules. */
function validateFile(file) {
  if (!ALLOWED_TYPES.includes(file.type)) return "Only JPG and PNG images are supported.";
  if (file.size > MAX_FILE_BYTES) return "Image must be smaller than 10 MB.";
  return null;
}

/** Apply a selected file: preview + state. */
function setFile(file) {
  const error = validateFile(file);
  if (error) {
    showImageError(error);
    showToast("error", "Invalid image", error);
    return;
  }

  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.file = file;
  state.previewUrl = URL.createObjectURL(file);

  $("#previewImg").src = state.previewUrl;
  $("#fileName").textContent = file.name;
  $("#fileSize").textContent = formatBytes(file.size);
  $("#uploadIdle").hidden = true;
  $("#uploadPreview").hidden = false;
  showImageError("");
  console.log("[upload] file selected:", file.name, `(${formatBytes(file.size)})`);
}

function clearFile() {
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.file = null;
  state.previewUrl = null;
  $("#imageInput").value = "";
  $("#previewImg").removeAttribute("src");
  $("#uploadIdle").hidden = false;
  $("#uploadPreview").hidden = true;
  showImageError("");
}

function bindUploadZone() {
  const zone = $("#uploadZone");
  const input = $("#imageInput");

  // Browse via click or keyboard
  zone.addEventListener("click", (event) => {
    if (event.target.closest(".preview-actions")) return;
    input.click();
  });
  zone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      input.click();
    }
  });

  input.addEventListener("change", () => {
    if (input.files && input.files[0]) setFile(input.files[0]);
  });

  // Drag & drop
  ["dragenter", "dragover"].forEach((type) =>
    zone.addEventListener(type, (event) => {
      event.preventDefault();
      event.stopPropagation();
      zone.classList.add("drag-over");
    })
  );
  ["dragleave", "drop"].forEach((type) =>
    zone.addEventListener(type, (event) => {
      event.preventDefault();
      event.stopPropagation();
      zone.classList.remove("drag-over");
    })
  );
  zone.addEventListener("drop", (event) => {
    const file = event.dataTransfer?.files?.[0];
    if (file) setFile(file);
  });

  // Preview actions
  $("#replaceBtn").addEventListener("click", (event) => {
    event.stopPropagation();
    input.click();
  });
  $("#removeBtn").addEventListener("click", (event) => {
    event.stopPropagation();
    clearFile();
  });
}

/* ══════════════ LOCATION VALIDATION ══════════════ */
function readCoordinates() {
  const latRaw = $("#latitudeInput").value.trim();
  const lngRaw = $("#longitudeInput").value.trim();

  if (!latRaw) return { error: "Latitude is required." };
  if (!lngRaw) return { error: "Longitude is required." };

  const lat = Number(latRaw);
  const lng = Number(lngRaw);
  if (Number.isNaN(lat)) return { error: "Latitude must be a valid number." };
  if (Number.isNaN(lng)) return { error: "Longitude must be a valid number." };
  if (lat < -90 || lat > 90) return { error: "Latitude must be between -90 and 90." };
  if (lng < -180 || lng > 180) return { error: "Longitude must be between -180 and 180." };

  return { lat, lng };
}

/* ══════════════ CURRENT LOCATION (navigator.geolocation) ══════════════
   Fills the Latitude/Longitude inputs with the device's real GPS fix.
   Values are written as actual input values (stays editable) and the
   analysis is NEVER submitted automatically. */
const LOCATION_DENIED_MSG =
  "Location permission was denied. Please allow location access or enter coordinates manually.";
const LOCATION_UNAVAILABLE_MSG =
  "Could not get your location. Please enter coordinates manually.";
const LOCATION_UNSUPPORTED_MSG =
  "Location is not supported by this browser. Please enter coordinates manually.";

function useCurrentLocation() {
  showLocationError("");

  if (!("geolocation" in navigator)) {
    showLocationError(LOCATION_UNSUPPORTED_MSG);
    return;
  }

  const button = $("#useLocationBtn");
  button.disabled = true;

  navigator.geolocation.getCurrentPosition(
    (position) => {
      $("#latitudeInput").value = String(position.coords.latitude);
      $("#longitudeInput").value = String(position.coords.longitude);
      showLocationError("");
      button.disabled = false;
      showToast("success", "Location updated", "Latitude and longitude were filled from your current location.");
      // Intentionally no auto-submit — the user reviews the values and clicks Analyze.
    },
    (error) => {
      button.disabled = false;
      showLocationError(error && error.code === 1 ? LOCATION_DENIED_MSG : LOCATION_UNAVAILABLE_MSG);
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}

/* ══════════════ AI ANALYSIS ══════════════ */
function setAnalyzeLoading(loading) {
  $("#analyzeBtn").disabled = loading;
  $("#analyzeBtnText").textContent = loading ? "Analyzing with AI..." : "Analyze Road Condition";
  $("#analyzeSpinner").hidden = !loading;
}

/**
 * POST /api/detections/analyze (multipart/form-data)
 * Fields: image, latitude, longitude + Authorization header.
 * Content-Type is intentionally NOT set manually — the browser
 * must add the multipart boundary itself.
 */
async function runAnalysis() {
  // 1. Authentication is required before analysis
  if (!state.token) {
    state.pendingAnalysis = true;
    $("#authNote").hidden = false;
    openLoginModal("Sign in to run AI road analysis.");
    showToast("info", "Sign in required", "Please sign in before running an analysis.");
    return;
  }

  // 2. Client-side validation with elegant, specific messages
  showImageError("");
  showLocationError("");

  if (!state.file) {
    showImageError("Please upload a road image before analyzing.");
    showToast("error", "Image required", "Upload a JPG or PNG road image to continue.");
    return;
  }

  const coords = readCoordinates();
  if (coords.error) {
    showLocationError(coords.error);
    showToast("error", "Location required", coords.error);
    return;
  }

  // 3. Send the multipart request
  setAnalyzeLoading(true);
  try {
    const formData = new FormData();
    formData.append("image", state.file);
    formData.append("latitude", String(coords.lat));
    formData.append("longitude", String(coords.lng));

    console.log("[analyze] request started:", {
      filename: state.file.name,
      latitude: coords.lat,
      longitude: coords.lng,
    });

    const json = await apiFetch("/api/detections/analyze", {
      method: "POST",
      body: formData,
      isForm: true,
    });

    console.log("[analyze] AI response received:", json);

    const detection = json?.data?.detection;
    if (!detection) throw new ApiError("The server returned an unexpected response.", "api");

    renderResult(detection);
    showToast("success", "Analysis complete", "The AI has finished evaluating the road image.");

    // Keep the overview cards in sync with the new record
    state.lastConfidence = detection.confidence;
    loadConfidenceCard();
    loadStats();
  } catch (error) {
    const message = error instanceof ApiError ? error.message : "Analysis failed. Please try again.";
    showToast("error", "Analysis failed", message);
  } finally {
    setAnalyzeLoading(false);
  }
}

function sourceLabel(source) {
  if (source === "yolo") return "YOLO Model";
  if (source === "mock") return "Mock Service";
  return source || "—";
}

function severityClass(severity) {
  const sev = String(severity || "").toLowerCase();
  return ["critical", "high", "medium", "low"].includes(sev) ? `sev-${sev}` : "sev-low";
}

/** Render the premium AI Detection Result panel. */
function renderResult(detection) {
  const resultCard = $("#resultCard");
  resultCard.hidden = false;

  // Detected banner (YES / NO + severity)
  const detected = Boolean(detection.potholeDetected);
  const banner = $("#detectedBanner");
  banner.classList.toggle("is-positive", detected);
  banner.classList.toggle("is-negative", !detected);

  const valueEl = $("#detectedValue");
  valueEl.textContent = detected ? "YES" : "NO";
  valueEl.className = `banner-value ${detected ? "yes" : "no"}`;

  const severity = detection.severity || "LOW";
  const severityEl = $("#severityBadge");
  severityEl.textContent = severity;
  severityEl.className = `severity-badge ${severityClass(severity)}`;

  // Summary tiles
  $("#resultCount").textContent = detection.potholeCount ?? 0;
  $("#resultConfidence").textContent = formatPercent(detection.confidence);
  $("#resultSource").textContent = sourceLabel(detection.aiSource);
  $("#resultTimestamp").textContent = formatDate(detection.timestamp);
  $("#resultLat").textContent = detection.latitude ?? "—";
  $("#resultLng").textContent = detection.longitude ?? "—";

  // Image frame — the uploaded preview with REAL YOLO boxes overlaid
  const img = $("#resultImage");
  if (state.previewUrl) img.src = state.previewUrl;
  else if (detection.imageUrl) img.src = detection.imageUrl;
  else img.removeAttribute("src");
  $("#resultFrameTime").textContent = formatDate(detection.timestamp, true);
  drawResultBoxes(img, detection);

  renderDetectionDetails(detection);
  resultCard.scrollIntoView({ behavior: "smooth", block: "start" });
}

/**
 * Normalise one entry from detections[].
 * Real YOLO rows: { class_name, confidence, bbox_xyxy: [x1,y1,x2,y2] }
 * Mock rows:      { class, confidence, x1, y1, x2, y2 }
 * Both shapes are supported; nothing is ever invented.
 */
function normalizeDetectionItem(item) {
  const bbox =
    Array.isArray(item.bbox_xyxy) && item.bbox_xyxy.length === 4
      ? item.bbox_xyxy
      : ["x1", "y1", "x2", "y2"].every((k) => item[k] !== null && item[k] !== undefined)
        ? [item.x1, item.y1, item.x2, item.y2]
        : null;
  return {
    className: item.class_name || item.class || "pothole",
    confidence: item.confidence,
    bbox,
  };
}

function formatBBox(bbox) {
  if (!bbox) return "—";
  const parts = bbox.map((v) => (Number.isFinite(Number(v)) ? Number(v).toFixed(2) : String(v)));
  return `[${parts.join(", ")}]`;
}

/* ══════════════ BOUNDING BOX OVERLAY (real YOLO boxes only) ══════════════
   Every box drawn here comes from detection.detections — the actual YOLO
   pixel coordinates returned by the AI service. Nothing is invented.
   Mapping uses the same "cover" math as object-fit: cover so boxes line up
   with the displayed (possibly cropped) image. */
let lastBoxRender = null;

function drawResultBoxes(img, detection) {
  lastBoxRender = { img, detection };
  img.onload = () => paintResultBoxes(); // draw once pixels are available
  paintResultBoxes(); // immediate draw when the image is already cached
}

function paintResultBoxes() {
  const canvas = $("#resultBoxes");
  if (!canvas || !lastBoxRender) return;

  const { img, detection } = lastBoxRender;
  const frame = canvas.parentElement; // .image-frame
  if (!frame || frame.contains(img) === false) return;

  const items = (Array.isArray(detection.detections) ? detection.detections : [])
    .map(normalizeDetectionItem)
    .filter((item) => item.bbox);

  const rect = frame.getBoundingClientRect();
  const imgRect = img.getBoundingClientRect();
  const natW = img.naturalWidth;
  const natH = img.naturalHeight;

  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);

  if (!natW || !natH || items.length === 0 || !imgRect.width || !imgRect.height) return;

  // object-fit: cover → image fills the box, overflow is cropped equally
  const scale = Math.max(imgRect.width / natW, imgRect.height / natH);
  const offsetX = imgRect.left - rect.left + (imgRect.width - natW * scale) / 2;
  const offsetY = imgRect.top - rect.top + (imgRect.height - natH * scale) / 2;

  const fontSize = Math.max(11, Math.round(natW * scale * 0.018));
  const lineW = Math.max(2, Math.round(natW * scale * 0.0035));
  ctx.lineWidth = lineW;
  ctx.font = `600 ${fontSize}px Inter, sans-serif`;
  ctx.textBaseline = "middle";
  const labelH = fontSize + 8;
  const padX = 6;

  items.forEach((item, index) => {
    const coords = item.bbox.map(Number);
    if (!coords.every(Number.isFinite)) return;

    const left = Math.max(0, offsetX + coords[0] * scale);
    const top = Math.max(0, offsetY + coords[1] * scale);
    const right = Math.min(rect.width, offsetX + coords[2] * scale);
    const bottom = Math.min(rect.height, offsetY + coords[3] * scale);

    ctx.strokeStyle = "#22d3ee";
    ctx.strokeRect(left, top, right - left, bottom - top);

    // Labels for the highest-confidence detections (boxes are sorted best
    // first) — labels on all 57 boxes would be unreadable.
    if (index < 10) {
      const label = `#${index + 1} ${item.className} ${formatPercent(item.confidence)}`;
      const textW = ctx.measureText(label).width;
      const labelY = top > labelH + 2 ? top - labelH - 2 : Math.min(top + 2, rect.height - labelH);
      ctx.fillStyle = "rgba(2, 6, 16, 0.88)";
      ctx.fillRect(left, labelY, textW + padX * 2, labelH);
      ctx.fillStyle = "#22d3ee";
      ctx.fillText(label, left + padX, labelY + labelH / 2 + 1);
    }
  });
}

// Keep boxes aligned when the layout resizes
window.addEventListener("resize", () => {
  if (lastBoxRender && $("#resultCard") && !$("#resultCard").hidden) paintResultBoxes();
});


function renderDetectionDetails(detection) {
  const items = (Array.isArray(detection.detections) ? detection.detections : []).map(normalizeDetectionItem);
  const tbody = $("#detectionsBody");
  const tableWrap = $("#detectionsTableWrap");
  const emptyBox = $("#detectionsEmpty");
  const emptyTitle = emptyBox.querySelector("h4");
  const emptyText = emptyBox.querySelector("p");

  $("#detailsCount").textContent = `${items.length} object${items.length === 1 ? "" : "s"}`;

  if (items.length > 0) {
    tbody.innerHTML = items
      .map(
        (item, index) => `
        <tr>
          <td><span class="row-index">${index + 1}</span></td>
          <td class="cell-strong">${escapeHtml(item.className.charAt(0).toUpperCase() + item.className.slice(1))}</td>
          <td>${formatPercent(item.confidence)}</td>
          <td><span class="cell-mono">${escapeHtml(formatBBox(item.bbox))}</span></td>
        </tr>`
      )
      .join("");
    tableWrap.hidden = false;
    emptyBox.hidden = true;
  } else {
    tableWrap.hidden = true;
    emptyBox.hidden = false;
    if (detection.potholeDetected) {
      emptyTitle.textContent = "Detailed boxes unavailable";
      emptyText.textContent = "The AI reported potholes, but no bounding-box data was returned for this analysis.";
    } else {
      emptyTitle.textContent = "No potholes detected";
      emptyText.textContent = "The model did not find any road defects in this image.";
    }
  }
}

/* ══════════════ DETECTION HISTORY ══════════════
   Consumes the existing GET /api/detections endpoint (read-only). */
const historyPage = { page: 1, limit: 10, totalPages: 1, total: 0 };

function setHistorySection(visibility) {
  // visibility: 'gate' | 'loading' | 'table' | 'empty' | 'error'
  $("#historyGate").hidden = visibility !== "gate";
  $("#historyLoading").hidden = visibility !== "loading";
  $("#historyError").hidden = visibility !== "error";
  $("#historyEmpty").hidden = visibility !== "empty";
  $("#historyCard").hidden = !["table", "empty", "error", "loading"].includes(visibility);
  $("#historyPagination").hidden = visibility !== "table";
  const tableWrap = $("#historyCard .table-wrap");
  if (tableWrap) tableWrap.hidden = visibility !== "table";
}

function renderHistoryGate() {
  setHistorySection("gate");
}

async function loadHistory() {
  if (!state.token) {
    renderHistoryGate();
    return;
  }
  setHistorySection("loading");

  try {
    const json = await apiFetch(
      `/api/detections?page=${historyPage.page}&limit=${historyPage.limit}`
    );
    const detections = json?.data?.detections || [];
    const pagination = json?.data?.pagination || {};

    historyPage.total = pagination.total ?? detections.length;
    historyPage.totalPages = pagination.totalPages ?? 1;

    // If the last record on this page was just deleted, step back a page
    // instead of incorrectly showing the "no detections" empty state.
    if (detections.length === 0 && historyPage.total > 0 && historyPage.page > 1) {
      historyPage.page = Math.max(1, historyPage.totalPages);
      loadHistory();
      return;
    }

    $("#historySummary").textContent =
      `${historyPage.total} record${historyPage.total === 1 ? "" : "s"} · newest first`;

    if (detections.length === 0) {
      $("#historyBody").innerHTML = "";
      setHistorySection("empty");
      return;
    }

    renderHistoryRows(detections);
    $("#historyPageInfo").textContent = `Page ${historyPage.page} of ${historyPage.totalPages}`;
    $("#historyPrevBtn").disabled = historyPage.page <= 1;
    $("#historyNextBtn").disabled = historyPage.page >= historyPage.totalPages;
    setHistorySection("table");
  } catch (error) {
    if (error instanceof ApiError && error.kind === "auth") {
      renderHistoryGate(); // session cleared → modal already opened
      return;
    }
    $("#historyErrorMessage").textContent =
      error instanceof ApiError ? error.message : "Something went wrong while fetching records.";
    setHistorySection("error");
  }
}

/* Role helpers — the UI mirrors the backend rules; the server enforces them. */
function currentUserRole() {
  return state.user?.role || null;
}

/** ADMIN sees Delete on every row; DRIVER only on their own rows; ANALYST never. */
function canShowDeleteColumn() {
  const role = currentUserRole();
  return role === "ADMIN" || role === "DRIVER";
}

function canDeleteDetection(detection) {
  const role = currentUserRole();
  if (role === "ADMIN") return true;
  if (role === "DRIVER") {
    return Boolean(detection.userId) && detection.userId === state.user?.id;
  }
  return false; // ANALYST and unknown roles never get a delete control
}

/** Status badge colour — reuses the existing badge colour classes. */
function statusBadgeClass(status) {
  switch (status) {
    case "PENDING":  return "badge-warn";
    case "VERIFIED": return "badge-accent";
    case "REJECTED": return "badge-danger";
    case "RESOLVED": return "badge-success";
    default:         return "badge-soft";
  }
}

/**
 * Admin review actions — mirrors the backend transition rules:
 *   PENDING  → Verify / Reject
 *   VERIFIED → Mark as Resolved
 *   REJECTED / RESOLVED → no status actions
 * Only ADMIN users see these controls; the server enforces the same rules.
 */
function statusActionsHtml(d) {
  if (currentUserRole() !== "ADMIN") return "";
  const status = String(d.status || "PENDING");
  const btn = (nextStatus, label) =>
    `<button type="button" class="btn btn-soft btn-xs row-status-btn" data-id="${escapeHtml(d.id)}" data-status="${nextStatus}">${label}</button>`;

  if (status === "PENDING") return btn("VERIFIED", "Verify") + btn("REJECTED", "Reject");
  if (status === "VERIFIED") return btn("RESOLVED", "Mark as Resolved");
  return ""; // REJECTED and RESOLVED are final — no status actions
}

function renderHistoryRows(detections) {
  const tbody = $("#historyBody");
  const showActions = canShowDeleteColumn();
  $("#historyActionsTh").hidden = !showActions;

  tbody.innerHTML = detections
    .map((d) => {
      const severity = String(d.severity || "LOW").toLowerCase();
      const status = String(d.status || "PENDING");
      const imageUrl = d.imageUrl
        ? `<img src="${escapeHtml(d.imageUrl)}" alt="" onerror="this.remove()" />`
        : "";
      // Admin status actions (Verify / Reject / Mark as Resolved) + delete control.
      // No controls for rows the user may not act on (backend refuses too).
      const statusBtns = statusActionsHtml(d);
      const deleteBtn = canDeleteDetection(d)
        ? `<button type="button" class="btn btn-soft btn-xs row-delete-btn" data-id="${escapeHtml(d.id)}" aria-label="Delete detection"><svg class="icon"><use href="#i-trash"></use></svg><span>Delete</span></button>`
        : "";
      const actionsCell = showActions
        ? statusBtns || deleteBtn
          ? `<td><div class="row-actions">${statusBtns}${deleteBtn}</div></td>`
          : `<td></td>`
        : "";
      return `
      <tr>
        <td><div class="thumb"><svg class="icon"><use href="#i-image"></use></svg>${imageUrl}</div></td>
        <td>${escapeHtml(formatDate(d.timestamp))}</td>
        <td>
          <div class="loc-cell">
            <span class="cell-strong">${Number(d.latitude).toFixed(4)}, ${Number(d.longitude).toFixed(4)}</span>
            <small>GPS coordinate</small>
          </div>
        </td>
        <td class="cell-strong">${d.potholeCount ?? 0}</td>
        <td>${escapeHtml(formatPercent(d.confidence))}</td>
        <td><span class="badge sev-${escapeHtml(severity)}">${escapeHtml(d.severity || "LOW")}</span></td>
        <td><span class="badge ${statusBadgeClass(status)}">${escapeHtml(status)}</span></td>
        ${actionsCell}
      </tr>`;
    })
    .join("");
}

/* ══════════════ DELETE FLOW (confirmation dialog → DELETE /api/detections/:id) ══════════════ */
let pendingDeleteId = null;

function openDeleteModal(id) {
  pendingDeleteId = id;
  $("#deleteModal").hidden = false;
  setTimeout(() => $("#deleteConfirmBtn")?.focus(), 60);
}

function closeDeleteModal() {
  pendingDeleteId = null;
  $("#deleteModal").hidden = true;
  setDeleteLoading(false);
}

function setDeleteLoading(loading) {
  $("#deleteConfirmBtn").disabled = loading;
  $("#deleteCancelBtn").disabled = loading;
  $("#deleteSpinner").hidden = !loading;
}

async function confirmDeleteDetection() {
  if (!pendingDeleteId) return;
  setDeleteLoading(true);
  try {
    await apiFetch(`/api/detections/${pendingDeleteId}`, { method: "DELETE" });
    closeDeleteModal();
    showToast("success", "Detection deleted", "The detection record has been removed.");
    await loadHistory(); // refresh Detection History after deletion
  } catch (error) {
    closeDeleteModal();
    showToast(
      "error",
      "Delete failed",
      error instanceof ApiError ? error.message : "The detection could not be deleted. Please try again."
    );
  }
}

/* ══════════════ STATUS WORKFLOW (PATCH /api/detections/:id/status) ══════════════
   Admin review actions on Detection History rows:
     PENDING  → Verify (VERIFIED) / Reject (REJECTED)
     VERIFIED → Mark as Resolved (RESOLVED)
     REJECTED / RESOLVED → no actions
   The backend validates the same transitions and requires an Admin JWT. */
const STATUS_SUCCESS_MESSAGES = {
  VERIFIED: "Detection verified successfully.",
  REJECTED: "Detection rejected successfully.",
  RESOLVED: "Detection marked as resolved.",
};

const statusUpdateInFlight = new Set(); // ids with an update pending — prevents duplicate clicks

async function updateDetectionStatusRow(id, newStatus, button) {
  if (!id || statusUpdateInFlight.has(id)) return;
  statusUpdateInFlight.add(id);

  // Disable this row's buttons while the request is in progress
  const row = button?.closest("tr");
  const rowButtons = row ? Array.from(row.querySelectorAll("button")) : [];
  rowButtons.forEach((b) => { b.disabled = true; });

  try {
    await apiFetch(`/api/detections/${id}/status`, {
      method: "PATCH",
      body: { status: newStatus },
    });
    showToast("success", "Status updated", STATUS_SUCCESS_MESSAGES[newStatus] || "Detection status updated.");
    await loadHistory(); // re-render the table with the fresh status (no manual refresh needed)
  } catch (error) {
    rowButtons.forEach((b) => { b.disabled = false; });
    showToast(
      "error",
      "Status update failed",
      error instanceof ApiError ? error.message : "The detection status could not be updated. Please try again."
    );
  } finally {
    statusUpdateInFlight.delete(id);
  }
}

/* ══════════════ ROAD INTELLIGENCE (real data only) ══════════════
   Sources: GET /api/dashboard/stats (exact totals) + GET /api/detections
   (up to 200 most recent records for spatial/derived metrics).
   Nothing here is invented — insufficient data shows an honest empty state. */
function listRow(mainHtml, rightHtml = "") {
  return `<div class="list-row">
    <div class="list-main">${mainHtml}</div>
    ${rightHtml ? `<div class="list-right">${rightHtml}</div>` : ""}
  </div>`;
}

function setIntelSection(visibility) {
  // visibility: 'loading' | 'empty' | 'content' | 'error'
  $("#intelLoading").hidden = visibility !== "loading";
  $("#intelEmpty").hidden = visibility !== "empty";
  $("#intelContent").hidden = visibility !== "content";
  $("#intelError").hidden = visibility !== "error";
}

function setReportSection(visibility) {
  // visibility: 'loading' | 'empty' | 'content' | 'error'
  $("#reportLoading").hidden = visibility !== "loading";
  $("#reportEmpty").hidden = visibility !== "empty";
  $("#reportContent").hidden = visibility !== "content";
  $("#reportError").hidden = visibility !== "error";
}

/** Fetch stats + detections once; shared by Intelligence and Reports. */
async function fetchInsightData() {
  const [statsJson, detectionsJson] = await Promise.all([
    apiFetch("/api/dashboard/stats"),
    apiFetch("/api/detections?page=1&limit=200"),
  ]);
  return {
    stats: statsJson?.data?.stats || null,
    detections: detectionsJson?.data?.detections || [],
  };
}

/**
 * Greedy clustering of detections by proximity (0.003° ≈ 330 m).
 * Clusters with 2+ records = potential pothole hotspot areas
 * (repeated detections at nearby/same coordinates).
 */
function detectHotspots(detections) {
  const THRESHOLD_DEG = 0.003;
  const clusters = [];
  for (const d of detections) {
    const lat = Number(d.latitude);
    const lng = Number(d.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    let cluster = null;
    for (const c of clusters) {
      if (Math.hypot(c.lat - lat, c.lng - lng) <= THRESHOLD_DEG) { cluster = c; break; }
    }
    const potholes = Number(d.potholeCount) || 0;
    if (cluster) {
      cluster.count += 1;
      cluster.potholes += potholes;
      cluster.sumLat += lat;
      cluster.sumLng += lng;
      if (new Date(d.timestamp).getTime() > new Date(cluster.latest).getTime()) cluster.latest = d.timestamp;
    } else {
      clusters.push({ lat, lng, sumLat: lat, sumLng: lng, count: 1, potholes, latest: d.timestamp });
    }
  }
  return clusters
    .filter((c) => c.count >= 2)
    .map((c) => ({ lat: c.sumLat / c.count, lng: c.sumLng / c.count, count: c.count, potholes: c.potholes, latest: c.latest }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
}

async function loadIntelligence() {
  if (!state.token) { setIntelSection("empty"); return; }
  setIntelSection("loading");
  try {
    const { stats, detections } = await fetchInsightData();
    const total = stats?.totalDetections ?? 0;
    if (!total) { setIntelSection("empty"); return; }

    const bySeverity = stats.bySeverity || {};
    const highCrit = (bySeverity.high ?? 0) + (bySeverity.critical ?? 0);
    const withConfidence = detections.filter((d) => d.confidence !== null && d.confidence !== undefined);
    const avgConfidence = withConfidence.length
      ? withConfidence.reduce((sum, d) => sum + Number(d.confidence), 0) / withConfidence.length
      : null;

    $("#intelTotal").textContent = total;
    $("#intelPotholes").textContent = stats.totalPotholes ?? 0;
    $("#intelHighCrit").textContent = highCrit;
    $("#intelConfidence").textContent = formatPercent(avgConfidence);
    $("#intelConfidenceSub").textContent = withConfidence.length
      ? `Across ${withConfidence.length} analysed record${withConfidence.length === 1 ? "" : "s"}`
      : "No confidence data yet";

    // Recent detection locations (API returns newest first)
    const recent = detections.slice(0, 6);
    $("#intelRecentSub").textContent = recent.length
      ? `Newest ${recent.length} GPS coordinate${recent.length === 1 ? "" : "s"} on record`
      : "No GPS coordinates on record";
    $("#intelRecent").innerHTML = recent.length
      ? recent.map((d) =>
          listRow(
            `<strong>${Number(d.latitude).toFixed(4)}, ${Number(d.longitude).toFixed(4)}</strong>
             <small>${escapeHtml(formatDate(d.timestamp))}</small>`,
            `<span class="badge sev-${escapeHtml(String(d.severity || "LOW").toLowerCase())}">${escapeHtml(d.severity || "LOW")}</span>`
          )
        ).join("")
      : `<div class="empty-state compact"><h4>No locations yet</h4><p>No detections with GPS coordinates are on record.</p></div>`;

    // Potential pothole hotspots — repeated detections at nearby coordinates
    const hotspots = detectHotspots(detections);
    $("#intelHotspotsEmpty").hidden = hotspots.length > 0;
    $("#intelHotspots").innerHTML = hotspots.map((c) =>
      listRow(
        `<strong>${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}</strong>
         <small>${c.count} detections · ${c.potholes} pothole${c.potholes === 1 ? "" : "s"} recorded here</small>`,
        `<span class="list-value">${c.count}×</span>
         <small class="list-time">${escapeHtml(formatDate(c.latest, true))}</small>`
      )
    ).join("");

    setIntelSection("content");
  } catch (error) {
    if (error instanceof ApiError && error.kind === "auth") { setIntelSection("empty"); return; }
    $("#intelErrorMessage").textContent =
      error instanceof ApiError ? error.message : "Something went wrong while fetching detection data.";
    setIntelSection("error");
  }
}

/* ══════════════ REPORTS (real data only) ══════════════ */
async function loadReports() {
  if (!state.token) { setReportSection("empty"); return; }
  setReportSection("loading");
  try {
    const { stats, detections } = await fetchInsightData();
    const total = stats?.totalDetections ?? 0;
    if (!total) { setReportSection("empty"); return; }

    const bySeverity = stats.bySeverity || {};

    // Unique detection locations (exact coordinates rounded to 4 dp)
    const locationCounts = new Map();
    for (const d of detections) {
      const lat = Number(d.latitude);
      const lng = Number(d.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const key = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
      locationCounts.set(key, (locationCounts.get(key) || 0) + 1);
    }
    const locations = [...locationCounts.entries()].sort((a, b) => b[1] - a[1]);

    // Recent activity — detections recorded in the last 7 days
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recentCount = detections.filter((d) => new Date(d.timestamp).getTime() >= sevenDaysAgo).length;

    $("#reportTotal").textContent = total;
    $("#reportPotholes").textContent = stats.totalPotholes ?? 0;
    $("#reportLocations").textContent = locations.length;
    $("#reportRecent").textContent = recentCount;

    // Severity distribution (counts + share of all detections)
    $("#reportSeverity").innerHTML = ["critical", "high", "medium", "low"]
      .map((key) => {
        const count = bySeverity[key] ?? 0;
        const pct = total ? (count / total) * 100 : 0;
        return `
        <div class="sev-bar-row">
          <div class="sev-bar-head">
            <span class="badge sev-${key}">${key.toUpperCase()}</span>
            <span class="sev-bar-count">${count} · ${pct.toFixed(1)}%</span>
          </div>
          <div class="sev-bar"><span class="sev-bar-fill sev-fill-${key}" style="width:${pct.toFixed(1)}%"></span></div>
        </div>`;
      })
      .join("");

    // Detection locations grouped by exact GPS position
    $("#reportLocationsEmpty").hidden = locations.length > 0;
    $("#reportLocationList").innerHTML = locations
      .slice(0, 8)
      .map(
        ([coords, count]) =>
          listRow(
            `<strong>${escapeHtml(coords)}</strong><small>${count} detection${count === 1 ? "" : "s"}</small>`,
            `<span class="list-value">${count}×</span>`
          )
      )
      .join("");

    // Recent activity (newest first — API sorts by timestamp desc)
    const recent = detections.slice(0, 5);
    $("#reportActivity").innerHTML = recent.length
      ? recent
          .map((d) =>
            listRow(
              `<strong>${escapeHtml(formatDate(d.timestamp))}</strong>
               <small>${Number(d.latitude).toFixed(4)}, ${Number(d.longitude).toFixed(4)} · ${d.potholeCount ?? 0} pothole${(d.potholeCount ?? 0) === 1 ? "" : "s"}</small>`,
              `<span class="badge sev-${escapeHtml(String(d.severity || "LOW").toLowerCase())}">${escapeHtml(d.severity || "LOW")}</span>
               <span class="badge badge-soft">${escapeHtml(d.status || "PENDING")}</span>`
            )
          )
          .join("")
      : `<div class="empty-state compact"><h4>No recent activity</h4><p>No detections are on record.</p></div>`;

    setReportSection("content");
  } catch (error) {
    if (error instanceof ApiError && error.kind === "auth") { setReportSection("empty"); return; }
    $("#reportErrorMessage").textContent =
      error instanceof ApiError ? error.message : "Something went wrong while fetching detection data.";
    setReportSection("error");
  }
}

/* ══════════════ EVENT WIRING ══════════════ */
function bindNavigation() {
  $$(".nav-item").forEach((item) => {
    item.addEventListener("click", () => switchView(item.dataset.view));
  });

  // Mobile / tablet collapsible sidebar
  $("#menuBtn").addEventListener("click", openSidebar);
  $("#sidebarClose").addEventListener("click", closeSidebar);
  $("#sidebarOverlay").addEventListener("click", closeSidebar);
}

function bindAuthControls() {
  // Sign in / Logout buttons (header + sidebar)
  $("#profileAuthBtn").addEventListener("click", () => {
    state.token ? handleLogout() : openLoginModal();
  });
  $("#sideAuthBtn").addEventListener("click", () => {
    state.token ? handleLogout() : openLoginModal();
  });

  // Hints that link to sign-in
  $("#statsHintBtn").addEventListener("click", () => openLoginModal());
  $("#authNoteBtn").addEventListener("click", () => openLoginModal());
  $("#historyGateBtn").addEventListener("click", () => openLoginModal());

  // Login modal
  $("#loginForm").addEventListener("submit", handleLoginSubmit);
  $("#loginCloseBtn").addEventListener("click", closeLoginModal);
  $("#loginModal").addEventListener("click", (event) => {
    // The unauthenticated login page is a gate — it cannot be dismissed.
    if (event.target === $("#loginModal") && !isLoginGateOpen()) closeLoginModal();
  });

  // Show / hide password
  $("#togglePassword").addEventListener("click", () => {
    const input = $("#loginPassword");
    const revealing = input.type === "password";
    input.type = revealing ? "text" : "password";
    $("#togglePassword").querySelector("use").setAttribute("href", revealing ? "#i-eye-off" : "#i-eye");
    $("#togglePassword").setAttribute("aria-label", revealing ? "Hide password" : "Show password");
  });

  // Escape closes delete dialog, then modal or mobile sidebar (never the login gate)
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!$("#deleteModal").hidden) {
      closeDeleteModal();
    } else if (!$("#loginModal").hidden) {
      if (!isLoginGateOpen()) closeLoginModal();
    } else closeSidebar();
  });
}

function bindAnalysisControls() {
  bindUploadZone();
  $("#analyzeBtn").addEventListener("click", runAnalysis);

  // Clear field errors while typing
  $("#latitudeInput").addEventListener("input", () => showLocationError(""));
  $("#longitudeInput").addEventListener("input", () => showLocationError(""));

  // GPS auto-fill — never submits the analysis
  $("#useLocationBtn").addEventListener("click", useCurrentLocation);
}

function bindHistoryControls() {
  $("#historyRefreshBtn").addEventListener("click", loadHistory);
  $("#historyRetryBtn").addEventListener("click", loadHistory);
  $("#historyPrevBtn").addEventListener("click", () => {
    if (historyPage.page > 1) {
      historyPage.page -= 1;
      loadHistory();
    }
  });
  $("#historyNextBtn").addEventListener("click", () => {
    if (historyPage.page < historyPage.totalPages) {
      historyPage.page += 1;
      loadHistory();
    }
  });

  // Row-level actions (event delegation — rows re-render on every load)
  $("#historyBody").addEventListener("click", (event) => {
    // Admin status workflow: Verify / Reject / Mark as Resolved
    const statusButton = event.target.closest(".row-status-btn");
    if (statusButton?.dataset.id) {
      updateDetectionStatusRow(statusButton.dataset.id, statusButton.dataset.status, statusButton);
      return;
    }
    const button = event.target.closest(".row-delete-btn");
    if (button?.dataset.id) openDeleteModal(button.dataset.id);
  });

  // Confirmation dialog
  $("#deleteCancelBtn").addEventListener("click", closeDeleteModal);
  $("#deleteConfirmBtn").addEventListener("click", confirmDeleteDetection);
  $("#deleteModal").addEventListener("click", (event) => {
    if (event.target === $("#deleteModal")) closeDeleteModal();
  });
}

function bindInsightControls() {
  $("#intelRetryBtn").addEventListener("click", loadIntelligence);
  $("#reportRetryBtn").addEventListener("click", loadReports);
}

/* ══════════════ INIT ══════════════ */
function init() {
  bindNavigation();
  bindAuthControls();
  bindAnalysisControls();
  bindHistoryControls();
  bindInsightControls();

  renderAuthUI();
  mountWorkspace("overview");

  // Real system status — polled, never faked
  checkHealth();
  setInterval(checkHealth, HEALTH_POLL_MS);

  // Restore a previously saved session (validates the token).
  // Without a session the full-page login gate is shown instead —
  // the dashboard is never accessible before authentication.
  if (state.token) restoreSession();
  else openLoginModal();
}

init();