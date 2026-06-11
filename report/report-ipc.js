"use strict";

const { ipcMain } = require('electron')
const { runMimoReport, runMimoPaygReport, runDeepseekReport, openBillingConfig } = require('./billing')
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
  ipcMain.on('report:mimo-login', () => {
    mimoLogin()
  })
  ipcMain.on('report:deepseek-login', () => {
    deepseekLogin()
  })
  ipcMain.on('report:open-config', () => {
    openBillingConfig()
  })
}

module.exports = { registerReportIpc }
