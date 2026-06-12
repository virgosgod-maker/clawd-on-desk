"use strict";

const { runUnifiedReport, openBillingConfig } = require('./billing')
const { mimoLogin, deepseekLogin } = require('./report-window')

/**
 * Build the "Usage Report" submenu template for context menu and tray menu.
 * Called from src/menu.js — runs in the main process, so click handlers
 * invoke report functions directly (no ipcRenderer needed).
 *
 * @param {Function} t  translator bound to current lang
 * @returns {Electron.MenuItemConstructorOptions[]}
 */
function buildReportSubmenu(t) {
  return [
    {
      label: 'AI 用量报告',
      click: () => { runUnifiedReport().catch(e => console.error('[Report Menu] unified:', e)) }
    },
    {
      label: t('reportRefreshLogin') || '刷新登录',
      submenu: [
        { label: 'MiMo', click: () => { mimoLogin() } },
        { label: 'DeepSeek', click: () => { deepseekLogin() } },
      ],
    },
    { type: 'separator' },
    { label: t('reportConfig') || '配置', click: () => { openBillingConfig() } },
  ]
}

module.exports = { buildReportSubmenu }
