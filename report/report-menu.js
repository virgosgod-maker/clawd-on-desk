"use strict";

const { runMimoReport, runMimoPaygReport, runDeepseekReport, openBillingConfig } = require('./billing')
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
      label: 'MiMo',
      submenu: [
        { label: t('reportPayg'), click: () => { runMimoPaygReport().catch(e => console.error('[Report Menu] mimo-payg:', e)) } },
        { label: t('reportPlan'), click: () => { runMimoReport().catch(e => console.error('[Report Menu] mimo-plan:', e)) } },
        { type: 'separator' },
        { label: t('reportRefreshLogin'), click: () => { mimoLogin() } },
      ],
    },
    {
      label: 'DeepSeek',
      submenu: [
        { label: t('reportPayg'), click: () => { runDeepseekReport().catch(e => console.error('[Report Menu] deepseek:', e)) } },
        { type: 'separator' },
        { label: t('reportRefreshLogin'), click: () => { deepseekLogin() } },
      ],
    },
    { type: 'separator' },
    { label: t('reportConfig'), click: () => { openBillingConfig() } },
  ]
}

module.exports = { buildReportSubmenu }
