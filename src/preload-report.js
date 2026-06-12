"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("reportAPI", {
  /**
   * 请求加载指定 Tab 的报告内容
   * @param {string} tabId - 'mimo-payg' | 'mimo-plan' | 'deepseek'
   * @returns {Promise<{content: string, script: string} | {error: string, detail: string}>}
   */
  loadTab: (tabId) => ipcRenderer.invoke("report:load-tab", tabId),
});
