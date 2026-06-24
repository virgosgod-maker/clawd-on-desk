"use strict";

const { BrowserWindow, nativeTheme } = require("electron");
const path = require("path");
const { clampTextScale, scaleWidth, scaleHeight, applyZoomToWindow } = require("./text-scale");

const DEFAULT_WIDTH = 900;
const DEFAULT_HEIGHT = 650;
const MIN_WIDTH = 640;
const MIN_HEIGHT = 480;
const LIGHT_BACKGROUND = "#f5f5f7";
const DARK_BACKGROUND = "#1c1c1f";

function getBackgroundColor() {
  return nativeTheme.shouldUseDarkColors ? DARK_BACKGROUND : LIGHT_BACKGROUND;
}

/**
 * @param {object} ctx
 * @param {function} ctx.t - translator
 * @param {function} ctx.getTextScale - returns text scale
 * @param {string} [ctx.iconPath] - window icon path
 */
module.exports = function initSessionViewer(ctx) {
  let win = null;
  const scheduleLater = typeof ctx.setTimeout === "function" ? ctx.setTimeout : setTimeout;

  function getTextScale() {
    return clampTextScale(typeof ctx.getTextScale === "function" ? ctx.getTextScale() : 1);
  }

  function getScaledMetrics() {
    const scale = getTextScale();
    return {
      defaultWidth: scaleWidth(DEFAULT_WIDTH, scale),
      defaultHeight: scaleHeight(DEFAULT_HEIGHT, scale),
      minWidth: scaleWidth(MIN_WIDTH, scale),
      minHeight: scaleHeight(MIN_HEIGHT, scale),
    };
  }

  function computeInitialBounds() {
    const metrics = getScaledMetrics();
    return {
      width: metrics.defaultWidth,
      height: metrics.defaultHeight,
    };
  }

  function createWindow() {
    const metrics = getScaledMetrics();
    const bounds = computeInitialBounds();
    const opts = {
      ...bounds,
      minWidth: metrics.minWidth,
      minHeight: metrics.minHeight,
      show: false,
      frame: true,
      transparent: false,
      resizable: true,
      minimizable: true,
      maximizable: true,
      skipTaskbar: false,
      alwaysOnTop: false,
      title: typeof ctx.t === "function" ? ctx.t("sessionViewerTitle") : "Session History",
      backgroundColor: getBackgroundColor(),
      webPreferences: {
        preload: path.join(__dirname, "preload-session-viewer.js"),
        nodeIntegration: false,
        contextIsolation: true,
      },
    };
    if (ctx.iconPath) opts.icon = ctx.iconPath;

    win = new BrowserWindow(opts);
    win.setMenuBarVisibility(false);
    win.loadFile(path.join(__dirname, "session-viewer.html"));

    let moveTextScaleTimer = null;
    win.on("move", () => {
      if (moveTextScaleTimer) clearTimeout(moveTextScaleTimer);
      moveTextScaleTimer = scheduleLater(() => {
        moveTextScaleTimer = null;
        applyTextScaleToWindow();
      }, 350);
    });

    win.webContents.once("did-finish-load", () => {
      applyZoomToWindow(win, getTextScale());
    });

    win.once("ready-to-show", () => {
      if (!win || win.isDestroyed()) return;
      win.show();
      win.focus();
    });

    win.on("closed", () => {
      win = null;
    });

    return win;
  }

  function syncThemeBackground() {
    if (!win || win.isDestroyed()) return;
    win.setBackgroundColor(getBackgroundColor());
  }

  if (nativeTheme && typeof nativeTheme.on === "function") {
    nativeTheme.on("updated", syncThemeBackground);
  }

  function showSessionViewer() {
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      return win;
    }
    return createWindow();
  }

  function applyTextScaleToWindow() {
    if (!win || win.isDestroyed()) return;
    const metrics = getScaledMetrics();
    applyZoomToWindow(win, getTextScale());
    if (typeof win.setMinimumSize === "function") {
      win.setMinimumSize(metrics.minWidth, metrics.minHeight);
    }
    if (typeof win.getBounds !== "function") return;
    const bounds = win.getBounds();
    if (bounds.width < metrics.minWidth || bounds.height < metrics.minHeight) {
      win.setBounds({
        ...bounds,
        width: Math.max(bounds.width, metrics.minWidth),
        height: Math.max(bounds.height, metrics.minHeight),
      });
    }
  }

  return {
    showSessionViewer,
    getWindow: () => win,
    applyTextScaleToWindow,
  };
};
