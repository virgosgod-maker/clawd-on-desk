"use strict";

/**
 * Session Viewer Core — JSONL parsing engine for Claude Code session history.
 * Ported from @zzusp/ccsm (claude-code-session) server/lib/.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");
const { execFileSync } = require("node:child_process");

// ── Constants ────────────────────────────────────────────────────────────────

const RECENT_ACTIVITY_WINDOW_MS = 5 * 60 * 1000;
const MAX_SESSION_MESSAGES = 5000;
const INTERRUPTED_MARKER_RE = /^\s*\[Request interrupted by user/;
const SYSTEM_TAG_RE = /^\s*<(local-command|system-reminder|caveat)/i;
const JSONL_EXT = ".jsonl";

// ── Paths ────────────────────────────────────────────────────────────────────

const isWin = process.platform === "win32";
const platformPath = isWin ? path.win32 : path.posix;
const claudeRoot = platformPath.join(os.homedir(), ".claude");

const PATHS = {
  root: claudeRoot,
  projects: platformPath.join(claudeRoot, "projects"),
  fileHistory: platformPath.join(claudeRoot, "file-history"),
  sessionEnv: platformPath.join(claudeRoot, "session-env"),
  sessions: platformPath.join(claudeRoot, "sessions"),
  history: platformPath.join(claudeRoot, "history.jsonl"),
};

function normalizeForCompare(p) {
  const resolved = platformPath.resolve(p);
  return isWin ? resolved.toLowerCase() : resolved;
}

const claudeRootNorm = normalizeForCompare(claudeRoot);

function isUnderClaudeRoot(target) {
  const norm = normalizeForCompare(target);
  return norm === claudeRootNorm || norm.startsWith(claudeRootNorm + platformPath.sep);
}

// ── Encode / Decode CWD ──────────────────────────────────────────────────────

const WIN_DRIVE_DOUBLE_DASH = /^([A-Za-z])--/;

function decodeCwd(encoded) {
  if (WIN_DRIVE_DOUBLE_DASH.test(encoded)) {
    const drive = encoded[0].toUpperCase();
    const rest = encoded.slice(3).replace(/-/g, "\\");
    return `${drive}:\\${rest}`;
  }
  if (encoded.startsWith("-")) {
    return "/" + encoded.slice(1).replace(/-/g, "/");
  }
  return encoded;
}

function encodeCwd(cwd) {
  if (path.isAbsolute(cwd) && /^[A-Za-z]:[\\/]/.test(cwd)) {
    const drive = cwd[0].toUpperCase();
    const rest = cwd.slice(3).replace(/[\\/]/g, "-");
    return `${drive}--${rest}`;
  }
  return cwd.replace(/\//g, "-");
}

// ── Safe ID ──────────────────────────────────────────────────────────────────

function isSafeId(id) {
  if (!id) return false;
  if (id.includes("/") || id.includes("\\") || id.includes("..")) return false;
  if (id.startsWith(".")) return false;
  return true;
}

// ── FS Size ──────────────────────────────────────────────────────────────────

function fileSize(p) {
  try {
    return fs.statSync(p).size;
  } catch {
    return 0;
  }
}

function dirSize(dir) {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const full = path.join(cur, ent.name);
      if (ent.isDirectory()) {
        stack.push(full);
      } else if (ent.isFile() || ent.isSymbolicLink()) {
        try {
          total += fs.statSync(full).size;
        } catch {
          /* skip */
        }
      }
    }
  }
  return total;
}

// ── System Tags ──────────────────────────────────────────────────────────────

function pickTitleText(text) {
  if (!/^\s*<command-(?:name|message|args)>/.test(text)) return text;
  const m = text.match(/<command-args>([\s\S]*?)<\/command-args>/);
  return (m?.[1] ?? "").trim();
}

// ── Active Sessions ──────────────────────────────────────────────────────────

function isPidAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  if (process.platform === "win32") {
    try {
      const out = execFileSync(
        "tasklist",
        ["/FI", `PID eq ${pid}`, "/NH", "/FO", "CSV"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      );
      return out.toLowerCase().includes(`"${pid}"`);
    } catch {
      return false;
    }
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

function listAlivePidsWindows() {
  const set = new Set();
  try {
    const out = execFileSync("tasklist", ["/NH", "/FO", "CSV"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(/^"[^"]*","(\d+)"/);
      if (m) set.add(Number(m[1]));
    }
  } catch {
    /* return whatever we have */
  }
  return set;
}

function readActivePidEntries() {
  if (!fs.existsSync(PATHS.sessions)) return [];
  const alivePids = process.platform === "win32" ? listAlivePidsWindows() : null;
  const entries = [];
  for (const name of fs.readdirSync(PATHS.sessions)) {
    if (!name.endsWith(".json")) continue;
    const full = path.join(PATHS.sessions, name);
    try {
      const obj = JSON.parse(fs.readFileSync(full, "utf8"));
      if (typeof obj.pid !== "number" || typeof obj.sessionId !== "string") continue;
      const alive = alivePids ? alivePids.has(obj.pid) : isPidAlive(obj.pid);
      entries.push({
        pid: obj.pid,
        sessionId: obj.sessionId,
        cwd: typeof obj.cwd === "string" ? obj.cwd : "",
        alive,
        sourceFile: full,
      });
    } catch {
      // skip malformed PID files
    }
  }
  return entries;
}

function buildActiveSessionMap() {
  const map = new Map();
  for (const e of readActivePidEntries()) {
    if (e.alive) map.set(e.sessionId, e.pid);
  }
  return map;
}

// ── Parse JSONL Meta ─────────────────────────────────────────────────────────

function endsWithToolUse(content) {
  if (!Array.isArray(content)) return false;
  for (let i = content.length - 1; i >= 0; i--) {
    const block = content[i];
    if (block && typeof block === "object" && typeof block.type === "string") {
      return block.type === "tool_use";
    }
  }
  return false;
}

function extractUserText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block && typeof block === "object" && block.type === "text" && typeof block.text === "string") {
        return block.text;
      }
    }
  }
  return "";
}

function countErrorResults(content) {
  if (!Array.isArray(content)) return 0;
  let n = 0;
  for (const block of content) {
    if (block && typeof block === "object" && block.type === "tool_result" && block.is_error === true) {
      n += 1;
    }
  }
  return n;
}

async function parseJsonlMeta(filePath) {
  let firstUserTitle = "";
  let aiTitle = null;
  let customTitle = null;
  let firstAt = null;
  let lastAt = null;
  let messageCount = 0;
  let errorCount = 0;
  let cwdFromMessages = null;
  let lastTurnIncomplete = false;

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  for await (const raw of rl) {
    const line = raw.trim();
    if (!line) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }

    const ts = typeof obj.timestamp === "string" ? obj.timestamp : null;
    if (ts) {
      if (!firstAt) firstAt = ts;
      lastAt = ts;
    }

    if (obj.cwd && typeof obj.cwd === "string" && !cwdFromMessages) {
      cwdFromMessages = obj.cwd;
    }

    if (obj.type === "custom-title" && typeof obj.customTitle === "string") {
      customTitle = obj.customTitle;
    }

    if (obj.type === "ai-title" && typeof obj.aiTitle === "string") {
      aiTitle = obj.aiTitle;
    }

    if (obj.type === "user" || obj.type === "assistant") {
      messageCount += 1;
      const msg = obj.message;
      errorCount += countErrorResults(msg?.content);

      if (obj.type === "assistant") {
        lastTurnIncomplete = endsWithToolUse(msg?.content);
      } else {
        const candidate = extractUserText(msg?.content);
        lastTurnIncomplete = !INTERRUPTED_MARKER_RE.test(candidate);

        if (!firstUserTitle && candidate && !SYSTEM_TAG_RE.test(candidate)) {
          const usable = pickTitleText(candidate);
          if (usable) {
            firstUserTitle = usable.slice(0, 80).replace(/\s+/g, " ").trim();
          }
        }
      }
    }
  }

  const mtimeIso = fs.statSync(filePath).mtime.toISOString();
  const reconciledLastAt = !lastAt || mtimeIso > lastAt ? mtimeIso : lastAt;

  return {
    title: aiTitle || firstUserTitle || "(untitled)",
    customTitle,
    firstAt,
    lastAt: reconciledLastAt,
    messageCount,
    errorCount,
    cwdFromMessages,
    lastTurnIncomplete,
  };
}

// ── Load Session Detail ──────────────────────────────────────────────────────

const STANDARD_CONTEXT_WINDOW = 200_000;
const LARGE_CONTEXT_WINDOW = 1_000_000;
const SUB_LARGE_CONTEXT_RE = /haiku|claude-3|claude-2|claude-instant/i;

function contextWindowFor(model, peakTokens) {
  const base = model !== null && SUB_LARGE_CONTEXT_RE.test(model)
    ? STANDARD_CONTEXT_WINDOW
    : LARGE_CONTEXT_WINDOW;
  return peakTokens > base ? LARGE_CONTEXT_WINDOW : base;
}

function contextTokensOf(obj) {
  const usage = obj.message?.usage;
  if (!usage || typeof usage !== "object") return null;
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const total = num(usage.input_tokens) + num(usage.cache_creation_input_tokens) + num(usage.cache_read_input_tokens);
  return total > 0 ? total : null;
}

function captureMeta(obj, meta) {
  if (typeof obj.cwd === "string" && !meta.cwd) meta.cwd = obj.cwd;
  if (typeof obj.gitBranch === "string" && !meta.gitBranch) meta.gitBranch = obj.gitBranch;
  if (typeof obj.version === "string" && !meta.version) meta.version = obj.version;
  if (obj.type === "custom-title" && typeof obj.customTitle === "string") {
    meta.customTitle = obj.customTitle;
  }
  const ts = typeof obj.timestamp === "string" ? obj.timestamp : null;
  if (ts) {
    if (!meta.firstAt) meta.firstAt = ts;
    meta.lastAt = ts;
  }
}

function deriveAutoTitle(messages) {
  for (const m of messages) {
    if (m.type !== "user" || m.isMeta) continue;
    for (const block of m.blocks) {
      if (block.type !== "text") continue;
      const usable = pickTitleText(block.text);
      if (!usable) continue;
      const line = usable.trim().split("\n")[0] ?? "";
      if (!line) continue;
      return line.length > 80 ? line.slice(0, 80) + "..." : line;
    }
  }
  return "(untitled)";
}

function stringifyToolResult(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => {
        if (b && typeof b === "object" && b.type === "text") {
          return typeof b.text === "string" ? b.text : "";
        }
        if (b && typeof b === "object" && b.type === "image") {
          return "[image]";
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function parseContent(content) {
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }
  if (!Array.isArray(content)) return [];

  const out = [];
  for (const raw of content) {
    if (!raw || typeof raw !== "object") continue;
    switch (raw.type) {
      case "text":
        out.push({ type: "text", text: typeof raw.text === "string" ? raw.text : "" });
        break;
      case "tool_use":
        out.push({
          type: "tool_use",
          id: typeof raw.id === "string" ? raw.id : "",
          name: typeof raw.name === "string" ? raw.name : "(unknown)",
          input: raw.input ?? null,
        });
        break;
      case "tool_result":
        out.push({
          type: "tool_result",
          toolUseId: typeof raw.tool_use_id === "string" ? raw.tool_use_id : "",
          content: stringifyToolResult(raw.content),
          isError: raw.is_error === true,
        });
        break;
      case "thinking":
        out.push({
          type: "thinking",
          text: typeof raw.thinking === "string" ? raw.thinking : "",
        });
        break;
      case "image": {
        const src = raw.source;
        out.push({
          type: "image",
          mediaType: typeof src?.media_type === "string" ? src.media_type : null,
        });
        break;
      }
      default:
        out.push({ type: "unknown", raw });
    }
  }
  return out;
}

function buildMessage(obj) {
  const type = obj.type === "user" ? "user" : "assistant";
  const message = obj.message ?? {};
  const blocks = parseContent(message.content);

  let isMeta = false;
  if (type === "user" && blocks.length === 1 && blocks[0].type === "text") {
    if (SYSTEM_TAG_RE.test(blocks[0].text)) isMeta = true;
  }

  return {
    uuid: typeof obj.uuid === "string" ? obj.uuid : "",
    parentUuid: typeof obj.parentUuid === "string" ? obj.parentUuid : null,
    type,
    ts: typeof obj.timestamp === "string" ? obj.timestamp : null,
    model: typeof message.model === "string" ? message.model : null,
    blocks,
    isMeta,
  };
}

async function loadSessionDetail(projectId, sessionId) {
  const jsonlPath = path.join(PATHS.projects, projectId, `${sessionId}.jsonl`);
  if (!fs.existsSync(jsonlPath)) return null;

  let bytes = 0;
  let mtimeIso = null;
  try {
    const stat = fs.statSync(jsonlPath);
    bytes = stat.size;
    mtimeIso = stat.mtime.toISOString();
  } catch {
    /* ignore */
  }

  const meta = {
    sessionId,
    projectId,
    cwd: null,
    gitBranch: null,
    version: null,
    firstAt: null,
    lastAt: null,
    messageCount: 0,
    bytes,
    title: "(untitled)",
    customTitle: null,
    contextTokens: null,
    contextWindow: 200_000,
  };

  const messages = [];
  let truncated = false;
  let aiTitle = null;
  let lastContextTokens = null;
  let peakContextTokens = 0;
  let lastModel = null;

  const rl = readline.createInterface({
    input: fs.createReadStream(jsonlPath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  for await (const raw of rl) {
    const line = raw.trim();
    if (!line) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }

    captureMeta(obj, meta);
    if (obj.type === "ai-title" && typeof obj.aiTitle === "string") {
      aiTitle = obj.aiTitle;
    }
    if (obj.type === "assistant") {
      const model = obj.message?.model;
      if (typeof model === "string" && model) lastModel = model;
      const used = contextTokensOf(obj);
      if (used !== null) {
        lastContextTokens = used;
        if (used > peakContextTokens) peakContextTokens = used;
      }
    }

    if (obj.type !== "user" && obj.type !== "assistant") continue;
    if (messages.length >= MAX_SESSION_MESSAGES) {
      truncated = true;
      continue;
    }

    const msg = buildMessage(obj);
    if (msg) messages.push(msg);
  }

  messages.sort((a, b) => (a.ts ?? "").localeCompare(b.ts ?? ""));

  if (mtimeIso && (!meta.lastAt || mtimeIso > meta.lastAt)) {
    meta.lastAt = mtimeIso;
  }

  meta.messageCount = messages.length;
  meta.title = aiTitle || deriveAutoTitle(messages);
  meta.contextTokens = lastContextTokens;
  meta.contextWindow = contextWindowFor(lastModel, peakContextTokens);
  return { meta, messages, truncated };
}

// ── Scan ─────────────────────────────────────────────────────────────────────

function listSessionIdsInProject(projectDir) {
  if (!fs.existsSync(projectDir)) return [];
  const ids = [];
  for (const ent of fs.readdirSync(projectDir, { withFileTypes: true })) {
    if (ent.isFile() && ent.name.endsWith(JSONL_EXT)) {
      ids.push(ent.name.slice(0, -JSONL_EXT.length));
    }
  }
  return ids;
}

function decodeProjectId(encoded, sampleCwd) {
  if (sampleCwd) return { decoded: sampleCwd, resolved: true };
  const decoded = decodeCwd(encoded);
  let resolved = false;
  try {
    resolved = fs.statSync(decoded).isDirectory();
  } catch {
    resolved = false;
  }
  return { decoded, resolved };
}

async function listProjects() {
  if (!fs.existsSync(PATHS.projects)) return [];
  const result = [];

  for (const ent of fs.readdirSync(PATHS.projects, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const projectId = ent.name;
    const projectDir = path.join(PATHS.projects, projectId);

    const sessionIds = listSessionIdsInProject(projectDir);
    let sampleCwd = null;
    let totalBytes = 0;
    let lastActiveAt = null;

    for (const id of sessionIds) {
      const jsonlPath = path.join(projectDir, `${id}${JSONL_EXT}`);
      const subdirPath = path.join(projectDir, id);
      totalBytes += fileSize(jsonlPath);
      totalBytes += dirSize(subdirPath);
      totalBytes += dirSize(path.join(PATHS.fileHistory, id));
      totalBytes += dirSize(path.join(PATHS.sessionEnv, id));

      if (!sampleCwd && fs.existsSync(jsonlPath)) {
        const meta = await parseJsonlMeta(jsonlPath);
        sampleCwd = meta.cwdFromMessages;
        if (meta.lastAt && (!lastActiveAt || meta.lastAt > lastActiveAt)) {
          lastActiveAt = meta.lastAt;
        }
      } else if (fs.existsSync(jsonlPath)) {
        try {
          const mtime = fs.statSync(jsonlPath).mtime.toISOString();
          if (!lastActiveAt || mtime > lastActiveAt) lastActiveAt = mtime;
        } catch {
          // ignore
        }
      }
    }

    const { decoded, resolved } = decodeProjectId(projectId, sampleCwd);

    result.push({
      id: projectId,
      encodedCwd: projectId,
      decodedCwd: decoded,
      cwdResolved: resolved,
      sessionCount: sessionIds.length,
      totalBytes,
      lastActiveAt,
    });
  }

  result.sort((a, b) => {
    const at = a.lastActiveAt ?? "";
    const bt = b.lastActiveAt ?? "";
    return bt.localeCompare(at);
  });
  return result;
}

async function buildSessionSummary(projectId, id, activeMap) {
  const projectDir = path.join(PATHS.projects, projectId);
  const jsonlPath = path.join(projectDir, `${id}${JSONL_EXT}`);
  const subdirPath = path.join(projectDir, id);
  const fhPath = path.join(PATHS.fileHistory, id);
  const sePath = path.join(PATHS.sessionEnv, id);

  const related = {
    jsonl: fileSize(jsonlPath),
    subdir: dirSize(subdirPath),
    fileHistory: dirSize(fhPath),
    sessionEnv: dirSize(sePath),
  };

  let title = "(no jsonl)";
  let customTitle = null;
  let firstAt = null;
  let lastAt = null;
  let messageCount = 0;
  let errorCount = 0;
  let lastTurnIncomplete = false;

  if (fs.existsSync(jsonlPath)) {
    const meta = await parseJsonlMeta(jsonlPath);
    title = meta.title;
    customTitle = meta.customTitle;
    firstAt = meta.firstAt;
    lastAt = meta.lastAt;
    messageCount = meta.messageCount;
    errorCount = meta.errorCount;
    lastTurnIncomplete = meta.lastTurnIncomplete;
  }

  const livePid = activeMap.get(id) ?? null;
  let isRecentlyActive = false;
  if (fs.existsSync(jsonlPath)) {
    try {
      const mtimeMs = fs.statSync(jsonlPath).mtimeMs;
      isRecentlyActive = Date.now() - mtimeMs < RECENT_ACTIVITY_WINDOW_MS;
    } catch {
      // ignore
    }
  }

  return {
    id,
    projectId,
    title,
    customTitle,
    firstAt,
    lastAt,
    messageCount,
    errorCount,
    bytes: related.jsonl,
    relatedBytes: related,
    isLivePid: livePid !== null,
    isRecentlyActive,
    livePid,
    isWorking: livePid !== null && isRecentlyActive && lastTurnIncomplete,
  };
}

async function listSessionsForProject(projectId) {
  const projectDir = path.join(PATHS.projects, projectId);
  if (!fs.existsSync(projectDir)) return [];

  const activeMap = buildActiveSessionMap();
  const ids = listSessionIdsInProject(projectDir);
  const out = [];

  for (const id of ids) {
    out.push(await buildSessionSummary(projectId, id, activeMap));
  }

  out.sort((a, b) => (b.lastAt ?? "").localeCompare(a.lastAt ?? ""));
  return out;
}

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  PATHS,
  isUnderClaudeRoot,
  isSafeId,
  decodeCwd,
  encodeCwd,
  listProjects,
  listSessionsForProject,
  loadSessionDetail,
};
