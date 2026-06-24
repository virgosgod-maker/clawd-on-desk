"use strict";

const { contextBridge, ipcRenderer } = require("electron");

// Simple markdown renderer fallback (no external dependency)
function simpleMarkdown(text) {
  if (!text) return "";
  let html = text
    // Code blocks (must be before inline code)
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="lang-$1">$2</code></pre>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Bold
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    // Italic (both * and _)
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\b_([^_]+)_\b/g, '<em>$1</em>')
    // Headers
    .replace(/^#### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // Unordered lists
    .replace(/^[\-\*] (.+)$/gm, '<li>$1</li>')
    // Blockquotes
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    // Horizontal rules
    .replace(/^---$/gm, '<hr>')
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    // Paragraphs
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');

  // Wrap in paragraph if not already wrapped
  if (!html.startsWith('<')) {
    html = '<p>' + html + '</p>';
  }
  return html;
}

contextBridge.exposeInMainWorld("svAPI", {
  listProjects: () => ipcRenderer.invoke("sv:list-projects"),
  listSessions: (projectId) => ipcRenderer.invoke("sv:list-sessions", projectId),
  loadSession: (projectId, sessionId) => ipcRenderer.invoke("sv:load-session", projectId, sessionId),
  getI18n: () => ipcRenderer.invoke("sv:get-i18n"),
  renderMarkdown: simpleMarkdown,
});
