"use strict";

const { BrowserWindow, app } = require('electron')
const path = require('path')
const fs = require('fs')
const { parseBillingFile, updateBillingConfig } = require('./billing')

// 获取图标路径，保持与项目其他窗口一致（优先使用 .ico 文件）
function getReportWindowIconPath() {
  try {
    const isPackaged = app.isPackaged
    const resourcesPath = process.resourcesPath
    const appDir = path.join(__dirname, '..')
    if (process.platform === 'win32') {
      if (isPackaged) {
        return [
          path.join(resourcesPath, 'icon.ico'),
          path.join(resourcesPath, 'app.asar.unpacked', 'assets', 'icon.ico'),
          path.join(resourcesPath, 'app.asar', 'assets', 'icon.ico'),
          path.join(resourcesPath, 'app.asar.unpacked', 'assets', 'icons', '256x256.png'),
          path.join(resourcesPath, 'app.asar', 'assets', 'icons', '256x256.png'),
        ].find(p => { try { return fs.existsSync(p) } catch { return false } })
      } else {
        return [
          path.join(appDir, 'assets', 'icon.ico'),
          path.join(appDir, 'assets', 'icons', '256x256.png'),
        ].find(p => { try { return fs.existsSync(p) } catch { return false } })
      }
    }
  } catch {}
  return undefined
}

// MiMo 内嵌浏览器登录 — 登录后自动抓取 Cookie 写入配置
function mimoLogin() {
  const { nativeImage } = require('electron')
  const kv = parseBillingFile()
  const savedUser = (kv.mimo_username || '').trim()
  const savedPass = (kv.mimo_password || '').trim()

  const opts = {
    width: 600, height: 700,
    title: 'MiMo 登录',
    autoHideMenuBar: true,
    minimizable: false,
    maximizable: false,
    webPreferences: { contextIsolation: true, sandbox: true, partition: 'persist:mimo-login' },
  }
  const iconPath = getReportWindowIconPath()
  if (iconPath) {
    opts.icon = nativeImage.createFromPath(iconPath)
    console.log('[MiMo Login] Icon loaded:', iconPath)
  }

  let loginWin = new BrowserWindow(opts)
  // 窗口创建后再次设置图标（解决 Windows 任务栏图标缓存问题）
  if (iconPath) {
    try { loginWin.setIcon(nativeImage.createFromPath(iconPath)) } catch (e) { console.error('[MiMo Login] setIcon error:', e) }
  }

  // 清空登录专用 partition 的 cookie，确保干净状态
  loginWin.webContents.session.clearStorageData({ storages: ['cookies'] }).then(() => {
    loginWin.loadURL('https://platform.xiaomimimo.com/login')
  })

  // 页面加载完成后自动填充账号密码
  // 使用 nativeInputValueSetter 绕过前端框架的 getter/setter 拦截
  loginWin.webContents.on('did-finish-load', () => {
    if (!savedUser || !savedPass) return
    loginWin.webContents.executeJavaScript(`
      (function() {
        var user = ${JSON.stringify(savedUser)};
        var pass = ${JSON.stringify(savedPass)};
        var inputs = document.querySelectorAll('input');
        var userInput = inputs[0];
        var passInput = Array.from(inputs).find(function(i) { return i.type === 'password'; });
        if (!userInput || !passInput) return;
        var nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeSetter.call(userInput, user);
        userInput.dispatchEvent(new Event('input', { bubbles: true }));
        userInput.dispatchEvent(new Event('change', { bubbles: true }));
        nativeSetter.call(passInput, pass);
        passInput.dispatchEvent(new Event('input', { bubbles: true }));
        passInput.dispatchEvent(new Event('change', { bubbles: true }));
      })()
    `).catch(() => {})
  })

  // 轮询 URL 检测登录成功（登录涉及 account.xiaomi.com 跨域跳转链，did-navigate 时机不可靠）
  let loginDone = false
  const checkLogin = setInterval(async () => {
    if (loginDone || loginWin.isDestroyed()) { clearInterval(checkLogin); return }
    try {
      const url = loginWin.webContents.getURL()
      if (!url.includes('/console')) return
      loginDone = true
      clearInterval(checkLogin)
      // 等 3 秒让所有跳转完成、Cookie 全部写入
      await new Promise(r => setTimeout(r, 3000))
      if (loginWin.isDestroyed()) return
      // 抓取会话中所有 Cookie（不限域名，登录涉及 account.xiaomi.com 跨域）
      const cookies = await loginWin.webContents.session.cookies.get({})
      const mimoCookies = cookies.filter(c =>
        c.domain.includes('xiaomimimo.com') || c.domain.includes('xiaomi.com')
      )
      const cookieStr = mimoCookies.map(c => c.name + '=' + c.value).join('; ')
      if (!cookieStr) {
        console.warn('[MiMo Login] No cookies captured')
        return
      }
      console.log('[MiMo Login] Captured', mimoCookies.length, 'cookies from', [...new Set(mimoCookies.map(c => c.domain))].join(', '))
      updateBillingConfig('mimo_cookie', cookieStr)
      loginWin.close()
      const { dialog } = require('electron')
      dialog.showMessageBox({ type: 'info', title: 'MiMo 登录', message: '登录成功，Cookie 已保存', buttons: ['确定'] })
    } catch (e) {
      console.error('[MiMo Login] Failed to capture cookies:', e)
    }
  }, 500)

  loginWin.on('closed', () => { loginDone = true; clearInterval(checkLogin); loginWin = null })
}

// DeepSeek 内嵌浏览器登录 — 从网络请求中拦截 auth token
function deepseekLogin() {
  const { nativeImage } = require('electron')
  const opts = {
    width: 600, height: 700,
    title: 'DeepSeek 登录',
    autoHideMenuBar: true,
    minimizable: false,
    maximizable: false,
    webPreferences: { contextIsolation: true, sandbox: true, partition: 'persist:deepseek-login' },
  }
  const iconPath = getReportWindowIconPath()
  if (iconPath) {
    opts.icon = nativeImage.createFromPath(iconPath)
    console.log('[DeepSeek Login] Icon loaded:', iconPath)
  }

  let loginWin = new BrowserWindow(opts)
  // 窗口创建后再次设置图标（解决 Windows 任务栏图标缓存问题）
  if (iconPath) {
    try { loginWin.setIcon(nativeImage.createFromPath(iconPath)) } catch (e) { console.error('[DeepSeek Login] setIcon error:', e) }
  }

  let loginDone = false

  // 拦截请求头，捕获 authorization（Bearer token）
  loginWin.webContents.session.webRequest.onBeforeSendHeaders(
    { urls: ['https://platform.deepseek.com/*'] },
    (details, callback) => {
      if (loginDone) { callback({ cancel: false }); return }
      const authHeader = details.requestHeaders['authorization'] || details.requestHeaders['Authorization']
      if (authHeader && authHeader.startsWith('Bearer ')) {
        loginDone = true
        const authToken = authHeader.slice(7)  // 去掉 "Bearer " 前缀
        console.log('[DeepSeek Login] Captured auth token, length:', authToken.length)
        // 抓取 Cookie
        loginWin.webContents.session.cookies.get({ domain: 'platform.deepseek.com' })
          .then(cookies => {
            const cookieStr = cookies.map(c => c.name + '=' + c.value).join('; ')
            console.log('[DeepSeek Login] Captured', cookies.length, 'cookies')
            if (authToken) updateBillingConfig('deepseek_auth_token', authToken)
            if (cookieStr) updateBillingConfig('deepseek_cookie', cookieStr)
            loginWin.close()
            const { dialog } = require('electron')
            dialog.showMessageBox({ type: 'info', title: 'DeepSeek 登录', message: '登录成功，配置已保存', buttons: ['确定'] })
          })
          .catch(e => console.error('[DeepSeek Login] Failed to capture cookies:', e))
      }
      callback({ cancel: false })
    }
  )

  // 先清空 session cookie，防止旧 cookie 导致误判
  loginWin.webContents.session.clearStorageData({ storages: ['cookies'] }).then(() => {
    // 直接打开 usage 页面，未登录会自动跳转到登录页
    loginWin.loadURL('https://platform.deepseek.com/usage')
  })

  loginWin.on('closed', () => { loginDone = true; loginWin = null })
}

module.exports = { mimoLogin, deepseekLogin }
