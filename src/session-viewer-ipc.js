"use strict";

const core = require("./session-viewer-core");

/**
 * Register IPC handlers for the Session Viewer window.
 * @param {object} ctx
 * @param {Electron.ipcMain} ctx.ipcMain
 * @param {function} ctx.getLang - returns current language code
 */
function registerSessionViewerIpc(ctx) {
  const { ipcMain, getLang } = ctx;

  const i18n = require("./i18n");

  function getI18nPayload() {
    const lang = typeof getLang === "function" ? getLang() : "en";
    const dict = i18n.i18n[lang] || i18n.i18n.en;
    return { lang, translations: { ...dict } };
  }

  ipcMain.handle("sv:list-projects", async () => {
    try {
      return await core.listProjects();
    } catch (err) {
      console.error("[session-viewer] listProjects failed:", err);
      return [];
    }
  });

  ipcMain.handle("sv:list-sessions", async (_event, projectId) => {
    try {
      if (!core.isSafeId(projectId)) return [];
      return await core.listSessionsForProject(projectId);
    } catch (err) {
      console.error("[session-viewer] listSessions failed:", err);
      return [];
    }
  });

  ipcMain.handle("sv:load-session", async (_event, projectId, sessionId) => {
    try {
      if (!core.isSafeId(projectId) || !core.isSafeId(sessionId)) return null;
      return await core.loadSessionDetail(projectId, sessionId);
    } catch (err) {
      console.error("[session-viewer] loadSession failed:", err);
      return null;
    }
  });

  ipcMain.handle("sv:get-i18n", () => {
    try {
      return getI18nPayload();
    } catch (err) {
      console.error("[session-viewer] getI18n failed:", err);
      return { lang: "en", translations: {} };
    }
  });
}

module.exports = { registerSessionViewerIpc };
