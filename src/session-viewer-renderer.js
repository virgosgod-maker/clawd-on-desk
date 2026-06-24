"use strict";

// ── State ────────────────────────────────────────────────────────────────────

let i18nPayload = { lang: "en", translations: {} };
let currentView = "projects"; // "projects" | "sessions" | "detail"
let currentProjectId = null;
let currentSessionId = null;
let projectsData = [];
let sessionsData = [];
let sessionDetail = null;

// Windowing state
const INITIAL_WINDOW = 300;
const WINDOW_STEP = 50;
let windowedCount = 0;

// Live tail state
let liveTailTimer = null;
const LIVE_POLL_INTERVAL = 2000;
const RECENT_ACTIVITY_WINDOW_MS = 5 * 60 * 1000;

// Search/filter state
let searchQuery = "";
let filterMode = "all"; // "all" | "system" | "user" | "error"

const breadcrumbEl = document.getElementById("breadcrumb");
const contentEl = document.getElementById("content");

// ── i18n ─────────────────────────────────────────────────────────────────────

function t(key) {
  const dict = i18nPayload && i18nPayload.translations ? i18nPayload.translations : {};
  return dict[key] || key;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatRelativeTime(isoString) {
  if (!isoString) return "";
  const ts = new Date(isoString).getTime();
  if (Number.isNaN(ts)) return "";
  const diff = Date.now() - ts;
  const sec = Math.max(0, Math.floor(diff / 1000));
  if (sec < 5) return t("sessionJustNow") || "just now";
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  return `${day}d`;
}

function escapeHtml(str) {
  if (!str) return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function createEl(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
}

function isSessionLive(session) {
  if (!session) return false;
  if (session.isLivePid) return true;
  if (session.lastAt) {
    const ts = new Date(session.lastAt).getTime();
    if (Date.now() - ts < RECENT_ACTIVITY_WINDOW_MS) return true;
  }
  return false;
}

// ── Breadcrumb ───────────────────────────────────────────────────────────────

function renderBreadcrumb() {
  breadcrumbEl.replaceChildren();

  // Projects root
  const projectsBtn = document.createElement("button");
  projectsBtn.type = "button";
  projectsBtn.className = "breadcrumb-item" + (currentView === "projects" ? " current" : "");
  projectsBtn.textContent = t("svProjects") || "Projects";
  if (currentView !== "projects") {
    projectsBtn.addEventListener("click", () => navigateTo("projects"));
  }
  breadcrumbEl.appendChild(projectsBtn);

  if (currentView === "sessions" || currentView === "detail") {
    breadcrumbEl.appendChild(createEl("span", "breadcrumb-sep", "›"));

    const sessionsBtn = document.createElement("button");
    sessionsBtn.type = "button";
    sessionsBtn.className = "breadcrumb-item" + (currentView === "sessions" ? " current" : "");
    const proj = projectsData.find((p) => p.id === currentProjectId);
    sessionsBtn.textContent = proj ? proj.decodedCwd : currentProjectId;
    if (currentView !== "sessions") {
      sessionsBtn.addEventListener("click", () => navigateTo("sessions"));
    }
    breadcrumbEl.appendChild(sessionsBtn);
  }

  if (currentView === "detail") {
    breadcrumbEl.appendChild(createEl("span", "breadcrumb-sep", "›"));
    const detailLabel = createEl("span", "breadcrumb-item current");
    if (sessionDetail && sessionDetail.meta) {
      const title = sessionDetail.meta.customTitle || sessionDetail.meta.title || "";
      detailLabel.textContent = title.length > 50 ? title.slice(0, 50) + "..." : title;
      detailLabel.title = title;
    } else {
      detailLabel.textContent = currentSessionId || "";
    }
    breadcrumbEl.appendChild(detailLabel);
  }
}

// ── Navigation ───────────────────────────────────────────────────────────────

function stopLiveTail() {
  if (liveTailTimer) {
    clearInterval(liveTailTimer);
    liveTailTimer = null;
  }
}

async function navigateTo(view, options = {}) {
  stopLiveTail();
  currentView = view;
  if (options.projectId !== undefined) currentProjectId = options.projectId;
  if (options.sessionId !== undefined) currentSessionId = options.sessionId;
  searchQuery = "";
  filterMode = "all";
  windowedCount = 0;

  renderBreadcrumb();
  contentEl.innerHTML = "";

  if (view === "projects") {
    await renderProjectsView();
  } else if (view === "sessions") {
    await renderSessionsView();
  } else if (view === "detail") {
    await renderDetailView();
  }
}

// ── Projects List ────────────────────────────────────────────────────────────

async function renderProjectsView() {
  contentEl.appendChild(createEl("div", "loading", t("svLoading") || "Loading..."));

  try {
    projectsData = await window.svAPI.listProjects();
  } catch (err) {
    contentEl.innerHTML = "";
    contentEl.appendChild(createEl("div", "empty", ""));
    contentEl.lastChild.appendChild(createEl("div", "empty-title", t("svError") || "Error"));
    contentEl.lastChild.appendChild(createEl("div", "empty-hint", err.message || String(err)));
    return;
  }

  contentEl.innerHTML = "";

  if (!projectsData || projectsData.length === 0) {
    const empty = createEl("div", "empty");
    empty.appendChild(createEl("div", "empty-title", t("svNoProjects") || "No projects found"));
    empty.appendChild(createEl("div", "empty-hint", t("svNoProjectsHint") || "Claude Code session data will appear here."));
    contentEl.appendChild(empty);
    return;
  }

  // Header
  const header = createEl("div", "table-header");
  header.appendChild(createEl("h2", "", t("svProjects") || "Projects"));
  header.appendChild(createEl("span", "table-count", `(${projectsData.length})`));
  contentEl.appendChild(header);

  // Table
  const table = document.createElement("table");
  table.className = "data-table";

  const thead = document.createElement("thead");
  thead.innerHTML = `<tr>
    <th>${escapeHtml(t("svColProject") || "Project")}</th>
    <th style="text-align:right;white-space:nowrap">${escapeHtml(t("svColSessions") || "Sessions")}</th>
    <th style="text-align:right;white-space:nowrap">${escapeHtml(t("svColSize") || "Size")}</th>
    <th style="white-space:nowrap">${escapeHtml(t("svColLastActive") || "Last Active")}</th>
  </tr>`;
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const proj of projectsData) {
    const tr = document.createElement("tr");
    tr.addEventListener("click", () => navigateTo("sessions", { projectId: proj.id }));

    const tdTitle = document.createElement("td");
    tdTitle.className = "col-title";
    tdTitle.textContent = proj.decodedCwd;
    tdTitle.title = proj.decodedCwd;
    tr.appendChild(tdTitle);

    const tdCount = document.createElement("td");
    tdCount.className = "col-num";
    tdCount.textContent = proj.sessionCount;
    tr.appendChild(tdCount);

    const tdSize = document.createElement("td");
    tdSize.className = "col-num";
    tdSize.textContent = formatBytes(proj.totalBytes);
    tr.appendChild(tdSize);

    const tdTime = document.createElement("td");
    tdTime.className = "col-time";
    tdTime.textContent = formatRelativeTime(proj.lastActiveAt);
    tr.appendChild(tdTime);

    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  contentEl.appendChild(table);
}

// ── Sessions List ────────────────────────────────────────────────────────────

function statusDotClass(session) {
  if (session.isWorking) return "dot dot-working";
  if (session.isLivePid) return "dot dot-live";
  if (session.isRecentlyActive) return "dot dot-recent";
  return "dot dot-idle";
}

async function renderSessionsView() {
  contentEl.appendChild(createEl("div", "loading", t("svLoading") || "Loading..."));

  try {
    sessionsData = await window.svAPI.listSessions(currentProjectId);
  } catch (err) {
    contentEl.innerHTML = "";
    contentEl.appendChild(createEl("div", "empty", ""));
    contentEl.lastChild.appendChild(createEl("div", "empty-title", t("svError") || "Error"));
    contentEl.lastChild.appendChild(createEl("div", "empty-hint", err.message || String(err)));
    return;
  }

  contentEl.innerHTML = "";

  if (!sessionsData || sessionsData.length === 0) {
    const empty = createEl("div", "empty");
    empty.appendChild(createEl("div", "empty-title", t("svNoSessions") || "No sessions found"));
    contentEl.appendChild(empty);
    return;
  }

  // Header
  const header = createEl("div", "table-header");
  header.appendChild(createEl("h2", "", t("svSessions") || "Sessions"));
  header.appendChild(createEl("span", "table-count", `(${sessionsData.length})`));
  contentEl.appendChild(header);

  // Table
  const table = document.createElement("table");
  table.className = "data-table";

  const thead = document.createElement("thead");
  thead.innerHTML = `<tr>
    <th style="width:28px"></th>
    <th>${escapeHtml(t("svColTitle") || "Title")}</th>
    <th style="text-align:right;white-space:nowrap">${escapeHtml(t("svColMessages") || "Msgs")}</th>
    <th style="text-align:right;white-space:nowrap">${escapeHtml(t("svColErrors") || "Err")}</th>
    <th style="text-align:right;white-space:nowrap">${escapeHtml(t("svColSize") || "Size")}</th>
    <th style="white-space:nowrap">${escapeHtml(t("svColLastActive") || "Last Active")}</th>
  </tr>`;
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const session of sessionsData) {
    const tr = document.createElement("tr");
    tr.addEventListener("click", () => navigateTo("detail", { sessionId: session.id }));

    // Status dot
    const tdDot = document.createElement("td");
    tdDot.style.width = "20px";
    const dot = document.createElement("span");
    dot.className = statusDotClass(session);
    tdDot.appendChild(dot);
    tr.appendChild(tdDot);

    // Title
    const tdTitle = document.createElement("td");
    tdTitle.className = "col-title";
    const displayTitle = session.customTitle || session.title || session.id;
    tdTitle.textContent = displayTitle;
    tdTitle.title = displayTitle;
    tr.appendChild(tdTitle);

    // Message count
    const tdMsgs = document.createElement("td");
    tdMsgs.className = "col-num";
    tdMsgs.textContent = session.messageCount;
    tr.appendChild(tdMsgs);

    // Error count
    const tdErrs = document.createElement("td");
    tdErrs.className = "col-num";
    tdErrs.textContent = session.errorCount || "";
    tr.appendChild(tdErrs);

    // Size
    const tdSize = document.createElement("td");
    tdSize.className = "col-num";
    tdSize.textContent = formatBytes(session.bytes);
    tr.appendChild(tdSize);

    // Last active
    const tdTime = document.createElement("td");
    tdTime.className = "col-time";
    tdTime.textContent = formatRelativeTime(session.lastAt);
    tr.appendChild(tdTime);

    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  contentEl.appendChild(table);
}

// ── Session Detail ───────────────────────────────────────────────────────────

function renderMetaBar(meta) {
  const bar = createEl("div", "session-meta-bar");

  // Session ID
  if (meta.sessionId) {
    const tag = createEl("span", "meta-tag");
    tag.appendChild(createEl("span", "meta-label", "id:"));
    const idSpan = createEl("span", "meta-value mono");
    idSpan.textContent = meta.sessionId;
    tag.appendChild(idSpan);
    bar.appendChild(tag);
  }

  if (meta.cwd) {
    const tag = createEl("span", "meta-tag");
    tag.appendChild(createEl("span", "meta-label", "cwd:"));
    tag.appendChild(document.createTextNode(meta.cwd));
    bar.appendChild(tag);
  }

  if (meta.gitBranch) {
    const tag = createEl("span", "meta-tag");
    tag.appendChild(createEl("span", "meta-label", "branch:"));
    tag.appendChild(document.createTextNode(meta.gitBranch));
    bar.appendChild(tag);
  }

  const tagMsgs = createEl("span", "meta-tag");
  tagMsgs.appendChild(createEl("span", "meta-label", t("svMessages") || "messages:"));
  tagMsgs.appendChild(document.createTextNode(String(meta.messageCount)));
  bar.appendChild(tagMsgs);

  const tagSize = createEl("span", "meta-tag");
  tagSize.appendChild(createEl("span", "meta-label", t("svSize") || "size:"));
  tagSize.appendChild(document.createTextNode(formatBytes(meta.bytes)));
  bar.appendChild(tagSize);

  if (meta.firstAt) {
    const tagStart = createEl("span", "meta-tag");
    tagStart.appendChild(createEl("span", "meta-label", t("svStarted") || "started:"));
    tagStart.appendChild(document.createTextNode(new Date(meta.firstAt).toLocaleString()));
    bar.appendChild(tagStart);
  }

  // Live indicator
  if (isSessionLive(sessionDetail)) {
    const liveTag = createEl("span", "meta-tag live-indicator");
    const liveDot = createEl("span", "dot dot-live");
    liveTag.appendChild(liveDot);
    liveTag.appendChild(document.createTextNode(t("svLive") || "Live"));
    bar.appendChild(liveTag);
  }

  return bar;
}

function renderToolbar() {
  const toolbar = createEl("div", "sv-toolbar");

  // Search input
  const searchWrapper = createEl("div", "sv-search-wrapper");
  const searchInput = document.createElement("input");
  searchInput.type = "text";
  searchInput.className = "sv-search-input";
  searchInput.placeholder = t("svSearchPlaceholder") || "Search messages...";
  searchInput.value = searchQuery;
  searchInput.addEventListener("input", () => {
    searchQuery = searchInput.value;
    debouncedRenderTimeline();
  });
  searchWrapper.appendChild(searchInput);

  // Clear search button
  if (searchQuery) {
    const clearBtn = createEl("button", "sv-search-clear", "×");
    clearBtn.addEventListener("click", () => {
      searchQuery = "";
      searchInput.value = "";
      debouncedRenderTimeline();
    });
    searchWrapper.appendChild(clearBtn);
  }

  toolbar.appendChild(searchWrapper);

  // Filter buttons
  const filterGroup = createEl("div", "sv-filter-group");
  const filters = [
    { key: "all", label: t("svFilterAll") || "All" },
    { key: "user", label: t("svFilterUser") || "User" },
    { key: "system", label: t("svFilterSystem") || "System" },
    { key: "error", label: t("svFilterError") || "Error" },
  ];

  for (const f of filters) {
    const btn = createEl("button", "sv-filter-btn" + (filterMode === f.key ? " active" : ""), f.label);
    btn.addEventListener("click", () => {
      filterMode = f.key;
      debouncedRenderTimeline();
      // Update active state
      filterGroup.querySelectorAll(".sv-filter-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
    });
    filterGroup.appendChild(btn);
  }

  toolbar.appendChild(filterGroup);

  return toolbar;
}

let renderTimelineTimer = null;
function debouncedRenderTimeline() {
  if (renderTimelineTimer) clearTimeout(renderTimelineTimer);
  renderTimelineTimer = setTimeout(() => {
    renderTimelineTimer = null;
    renderTimeline();
  }, 150);
}

function filterMessages(messages) {
  let filtered = messages;

  // Apply filter mode
  if (filterMode === "user") {
    filtered = filtered.filter((m) => m.type === "user" && !m.isMeta);
  } else if (filterMode === "system") {
    filtered = filtered.filter((m) => m.isMeta || (m.type === "user" && m.blocks.some((b) => b.type === "text" && b.text && b.text.match(/^\s*<(local-command|system-reminder|caveat)/))));
  } else if (filterMode === "error") {
    filtered = filtered.filter((m) => m.blocks.some((b) => b.type === "tool_result" && b.isError));
  } else {
    filtered = filtered.filter((m) => !m.isMeta);
  }

  // Apply search query
  if (searchQuery.trim()) {
    const query = searchQuery.toLowerCase();
    filtered = filtered.filter((m) => {
      return m.blocks.some((b) => {
        if (b.type === "text" && b.text && b.text.toLowerCase().includes(query)) return true;
        if (b.type === "tool_use" && b.name && b.name.toLowerCase().includes(query)) return true;
        if (b.type === "tool_result" && b.content && b.content.toLowerCase().includes(query)) return true;
        if (b.type === "thinking" && b.text && b.text.toLowerCase().includes(query)) return true;
        return false;
      });
    });
  }

  return filtered;
}

function renderTimeline() {
  const timeline = contentEl.querySelector(".timeline");
  if (!timeline) return;

  // Save scroll position
  const wasAtBottom = contentEl.scrollHeight - contentEl.scrollTop - contentEl.clientHeight < 50;

  timeline.innerHTML = "";

  if (!sessionDetail || !sessionDetail.messages) return;

  const allMessages = sessionDetail.messages;
  const filtered = filterMessages(allMessages);

  // Windowing
  const totalFiltered = filtered.length;
  const startIdx = Math.max(0, totalFiltered - windowedCount);
  const windowed = filtered.slice(startIdx);

  // Show "Load earlier" button if there are more messages
  if (startIdx > 0) {
    const loadMoreBtn = createEl("button", "sv-load-more");
    const remaining = startIdx;
    loadMoreBtn.textContent = (t("svLoadEarlier") || "Load earlier messages") + ` (${remaining})`;
    loadMoreBtn.addEventListener("click", () => {
      windowedCount += WINDOW_STEP;
      renderTimeline();
    });
    timeline.appendChild(loadMoreBtn);
  }

  // Render messages
  for (const msg of windowed) {
    const el = renderMessage(msg);
    if (el) timeline.appendChild(el);
  }

  // Truncation notice
  if (sessionDetail.truncated) {
    const notice = createEl("div", "truncated-notice");
    notice.textContent = t("svTruncated") || "Some messages were truncated.";
    timeline.appendChild(notice);
  }

  // Auto-scroll to bottom if was at bottom
  if (wasAtBottom) {
    requestAnimationFrame(() => {
      contentEl.scrollTop = contentEl.scrollHeight;
    });
  }
}

function getToolInputPreview(block) {
  if (!block.input || typeof block.input !== "object") return "";
  try {
    const keys = Object.keys(block.input);
    if (keys.length === 0) return "";
    const firstKey = keys[0];
    const val = block.input[firstKey];
    if (typeof val === "string") {
      return val.length > 60 ? val.slice(0, 60) + "..." : val;
    }
    return firstKey + ": ...";
  } catch {
    return "";
  }
}

function renderToolUseBlock(block) {
  const container = createEl("div", "tool-block");

  const header = createEl("div", "tool-header");
  const nameSpan = createEl("span", "tool-name", block.name);
  header.appendChild(nameSpan);

  // Add input preview
  const preview = getToolInputPreview(block);
  if (preview) {
    const previewSpan = createEl("span", "tool-preview", preview);
    header.appendChild(previewSpan);
  }

  header.addEventListener("click", () => {
    container.classList.toggle("open");
  });
  container.appendChild(header);

  const body = createEl("div", "tool-body");
  if (block.input !== null && block.input !== undefined) {
    try {
      const jsonStr = typeof block.input === "string"
        ? block.input
        : JSON.stringify(block.input, null, 2);
      body.innerHTML = highlightJson(jsonStr);
    } catch {
      body.textContent = String(block.input);
    }
  }
  container.appendChild(body);

  return container;
}

function highlightJson(str) {
  return escapeHtml(str)
    .replace(/"([^"]+)":/g, '<span class="json-key">"$1"</span>:')
    .replace(/: "([^"]*?)"/g, ': <span class="json-string">"$1"</span>')
    .replace(/: (\d+)/g, ': <span class="json-number">$1</span>')
    .replace(/: (true|false|null)/g, ': <span class="json-keyword">$1</span>');
}

function renderToolResultBlock(block) {
  const container = createEl("div", "tool-result");

  if (block.isError) {
    const errorHeader = createEl("div", "tool-result-header tool-result-error-header", "Error");
    container.appendChild(errorHeader);
    container.classList.add("tool-result-error");
  }

  const contentEl = createEl("div", "tool-result-content");
  contentEl.textContent = block.content || "";
  container.appendChild(contentEl);

  return container;
}

function renderThinkingBlock(block) {
  const container = createEl("div", "thinking-block");
  const header = createEl("div", "thinking-header", "\u{1F4AD} " + (t("svThinking") || "Thinking"));
  header.addEventListener("click", () => {
    container.classList.toggle("open");
  });
  container.appendChild(header);

  const body = createEl("div", "thinking-body");
  body.textContent = block.text || "";
  container.appendChild(body);

  return container;
}

function formatTimestamp(ts) {
  if (!ts) return "";
  try {
    const date = new Date(ts);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function renderMessage(msg) {
  // Skip system/meta messages
  if (msg.isMeta) return null;

  // Build a map of tool_use_id -> tool_use block for inlining results
  const toolUseMap = new Map();
  for (const block of msg.blocks) {
    if (block.type === "tool_use" && block.id) {
      toolUseMap.set(block.id, block);
    }
  }

  const wrapper = createEl("div", "msg msg-" + msg.type);

  // Add header with timestamp and model info
  const header = createEl("div", "msg-header");
  if (msg.ts) {
    header.appendChild(createEl("span", "msg-timestamp", formatTimestamp(msg.ts)));
  }
  if (msg.type === "assistant" && msg.model) {
    const modelShort = msg.model.split("/").pop() || msg.model;
    header.appendChild(createEl("span", "msg-model", modelShort));
  }
  if (header.childNodes.length > 0) {
    wrapper.appendChild(header);
  }

  for (const block of msg.blocks) {
    if (block.type === "text") {
      if (block.text && block.text.trim()) {
        const textEl = createEl("div", "msg-text");
        // Use markdown for assistant messages
        if (msg.type === "assistant" && window.svAPI && typeof window.svAPI.renderMarkdown === "function") {
          try {
            textEl.innerHTML = window.svAPI.renderMarkdown(block.text);
          } catch (e) {
            console.warn("renderMarkdown failed:", e);
            textEl.textContent = block.text;
          }
        } else {
          textEl.textContent = block.text;
        }
        wrapper.appendChild(textEl);
      }
    } else if (block.type === "tool_use") {
      wrapper.appendChild(renderToolUseBlock(block));
    } else if (block.type === "tool_result") {
      const parentUse = toolUseMap.get(block.toolUseId);
      if (parentUse) {
        const toolBlocks = wrapper.querySelectorAll(".tool-block");
        const targetBlock = toolBlocks[toolBlocks.length - 1];
        if (targetBlock) {
          targetBlock.appendChild(renderToolResultBlock(block));
          continue;
        }
      }
      wrapper.appendChild(renderToolResultBlock(block));
    } else if (block.type === "thinking") {
      wrapper.appendChild(renderThinkingBlock(block));
    }
  }

  return wrapper;
}

function startLiveTail() {
  stopLiveTail();
  if (!isSessionLive(sessionDetail)) return;

  liveTailTimer = setInterval(async () => {
    try {
      const newDetail = await window.svAPI.loadSession(currentProjectId, currentSessionId);
      if (newDetail && newDetail.messages) {
        const oldCount = sessionDetail ? sessionDetail.messages.length : 0;
        sessionDetail = newDetail;
        if (newDetail.messages.length !== oldCount) {
          // New messages arrived, update windowed count
          windowedCount = Math.max(windowedCount, INITIAL_WINDOW);
          renderTimeline();
          // Update meta bar
          const metaBar = contentEl.querySelector(".session-meta-bar");
          if (metaBar) {
            metaBar.replaceWith(renderMetaBar(sessionDetail.meta));
          }
        }
      }
    } catch (err) {
      console.warn("Live tail poll failed:", err);
    }
  }, LIVE_POLL_INTERVAL);
}

function renderDetailView() {
  contentEl.appendChild(createEl("div", "loading", t("svLoading") || "Loading..."));

  window.svAPI.loadSession(currentProjectId, currentSessionId)
    .then((detail) => {
      sessionDetail = detail;
      contentEl.innerHTML = "";

      if (!sessionDetail || !sessionDetail.meta) {
        const empty = createEl("div", "empty");
        empty.appendChild(createEl("div", "empty-title", t("svNoSessionData") || "Session not found"));
        contentEl.appendChild(empty);
        return;
      }

      // Update breadcrumb with title
      renderBreadcrumb();

      // Sticky header wrapper (meta bar + toolbar)
      const stickyHeader = createEl("div", "sv-sticky-header");
      stickyHeader.appendChild(renderMetaBar(sessionDetail.meta));
      stickyHeader.appendChild(renderToolbar());
      contentEl.appendChild(stickyHeader);

      // Timeline container
      const timeline = createEl("div", "timeline");
      contentEl.appendChild(timeline);

      // Initial windowed count
      windowedCount = INITIAL_WINDOW;

      // Render timeline
      renderTimeline();

      // Scroll to top to show toolbar
      requestAnimationFrame(() => {
        contentEl.scrollTop = 0;
      });

      // Start live tail polling if session is active
      startLiveTail();
    })
    .catch((err) => {
      contentEl.innerHTML = "";
      contentEl.appendChild(createEl("div", "empty", ""));
      contentEl.lastChild.appendChild(createEl("div", "empty-title", t("svError") || "Error"));
      contentEl.lastChild.appendChild(createEl("div", "empty-hint", err.message || String(err)));
    });
}

// ── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  try {
    i18nPayload = await window.svAPI.getI18n();
  } catch (err) {
    console.warn("Failed to load i18n:", err);
  }

  await navigateTo("projects");
}

init().catch((err) => {
  contentEl.textContent = err && err.message ? err.message : String(err);
});
