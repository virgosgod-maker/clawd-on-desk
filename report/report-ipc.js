"use strict";

const { ipcMain } = require('electron')
const { runMimoReport, runMimoPaygReport, runDeepseekReport, runUnifiedReport, loadTabContent, openBillingConfig } = require('./billing')
const { mimoLogin, deepseekLogin } = require('./report-window')

function registerReportIpc() {
  ipcMain.on('report:mimo-payg', () => {
    runMimoPaygReport().catch(e => console.error('[Report IPC] mimo-payg error:', e))
  })
  ipcMain.on('report:mimo-plan', () => {
    runMimoReport().catch(e => console.error('[Report IPC] mimo-plan error:', e))
  })
  ipcMain.on('report:deepseek', () => {
    runDeepseekReport().catch(e => console.error('[Report IPC] deepseek error:', e))
  })
  ipcMain.on('report:unified', () => {
    runUnifiedReport().catch(e => console.error('[Report IPC] unified error:', e))
  })
  ipcMain.on('report:mimo-login', () => {
    mimoLogin()
  })
  ipcMain.on('report:deepseek-login', () => {
    deepseekLogin()
  })
  ipcMain.on('report:open-config', () => {
    openBillingConfig()
  })

  // 按需加载 Tab 数据（由统一报告窗口的 preload 脚本调用）
  ipcMain.handle('report:load-tab', async (_event, tabId) => {
    try {
      return await loadTabContent(tabId)
    } catch (e) {
      console.error('[Report IPC] load-tab error:', e)
      return { error: '加载失败', detail: e.message }
    }
  })
}

module.exports = { registerReportIpc }
