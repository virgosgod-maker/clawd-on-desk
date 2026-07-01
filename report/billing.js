const https = require('https')
const fs = require('fs')
const path = require('path')
const os = require('os')

const BILLING_DIR = path.join(os.homedir(), '.clawd-on-desk', 'billing')
const BILLING_FILE = path.join(BILLING_DIR, 'billing.txt')

const DEFAULT_PRICES = {
  mimo: {
    'mimo-v2.5':     { cacheHit: 0.02,  cacheMiss: 1.00, output: 2.00 },
    'mimo-v2.5-pro': { cacheHit: 0.025, cacheMiss: 3.00, output: 6.00 },
  },
  deepseek: {
    'deepseek-v4-pro':   { cacheHit: 0.02, cacheMiss: 1.00, output: 2.00 },
    'deepseek-v4-flash': { cacheHit: 0.02, cacheMiss: 1.00, output: 2.00 },
  },
}

const DEFAULT_BILLING_TEXT = [
  '# ── MiMo ──',
  'mimo_cookie=',
  '',
  '# ── DeepSeek ──',
  'deepseek_auth_token=',
  'deepseek_cookie=',
  '',
  '# ── MiMo 套餐（元/年，除以12为月费）──',
  'mimo_plans=' + JSON.stringify([
    { name: 'Lite',     annual: 411.84 },
    { name: 'Standard', annual: 1045.44 },
    { name: 'Pro',      annual: 3474.24 },
    { name: 'Max',      annual: 6959.04 },
  ]),
  '',
  '# ── 模型价格（元/百万Token，一般无需修改）──',
  'mimo_prices=' + JSON.stringify(DEFAULT_PRICES.mimo),
  'deepseek_prices=' + JSON.stringify(DEFAULT_PRICES.deepseek),
  '',
  '# ── Tab 显示顺序（逗号分隔）──',
  'tab_order=mimo-plan,mimo-payg,deepseek',
  '',
].join('\n')

// ── 配置（单文件 key=value 格式，无需转义）─────────

function parseBillingFile() {
  const result = {}
  if (!fs.existsSync(BILLING_FILE)) return result
  const lines = fs.readFileSync(BILLING_FILE, 'utf-8').split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx < 0) continue
    result[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim()
  }
  return result
}

function loadConfig() {
  try {
    fs.mkdirSync(BILLING_DIR, { recursive: true })
    if (!fs.existsSync(BILLING_FILE)) {
      fs.writeFileSync(BILLING_FILE, DEFAULT_BILLING_TEXT, 'utf-8')
    }
    const kv = parseBillingFile()
    const mimoPrices = kv.mimo_prices ? JSON.parse(kv.mimo_prices) : DEFAULT_PRICES.mimo
    const dsPrices = kv.deepseek_prices ? JSON.parse(kv.deepseek_prices) : DEFAULT_PRICES.deepseek
    const mimoPlans = kv.mimo_plans ? JSON.parse(kv.mimo_plans) : [
      { name: 'Lite',     annual: 411.84 },
      { name: 'Standard', annual: 1045.44 },
      { name: 'Pro',      annual: 3474.24 },
      { name: 'Max',      annual: 6959.04 },
    ]
    // 去掉用户可能粘贴的外层引号
    const strip = s => { s = (s || '').trim(); return (s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")) ? s.slice(1, -1) : s }
    return {
      mimo: { cookie: strip(kv.mimo_cookie), prices: mimoPrices, plans: mimoPlans },
      deepseek: { authToken: strip(kv.deepseek_auth_token), cookie: strip(kv.deepseek_cookie), prices: dsPrices },
      tabOrder: kv.tab_order || '',
    }
  } catch {
    return {
      mimo: { cookie: '', prices: DEFAULT_PRICES.mimo },
      deepseek: { authToken: '', cookie: '', prices: DEFAULT_PRICES.deepseek },
    }
  }
}

// 更新 billing.txt 中的指定 key，保留其他内容
function updateBillingConfig(key, value) {
  try {
    fs.mkdirSync(BILLING_DIR, { recursive: true })
    let content = ''
    try { content = fs.readFileSync(BILLING_FILE, 'utf-8') } catch {}
    const lines = content.split('\n')
    let found = false
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim()
      if (trimmed.startsWith(key + '=')) {
        lines[i] = key + '=' + value
        found = true
        break
      }
    }
    if (!found) lines.push(key + '=' + value)
    fs.writeFileSync(BILLING_FILE, lines.join('\n'), 'utf-8')
  } catch (e) {
    console.error('[Billing] Failed to update config:', e)
  }
}

function openBillingConfig() {
  const { shell, dialog } = require('electron')
  fs.mkdirSync(BILLING_DIR, { recursive: true })
  if (!fs.existsSync(BILLING_FILE)) {
    fs.writeFileSync(BILLING_FILE, DEFAULT_BILLING_TEXT, 'utf-8')
  }
  shell.openPath(BILLING_FILE)
  dialog.showMessageBox({
    type: 'info',
    title: '配置',
    message: '配置文件已打开',
    detail: BILLING_FILE + '\n\n'
      + '格式：key=value（每行一个）\n'
      + '  mimo_cookie=粘贴MiMo Cookie\n'
      + '  deepseek_auth_token=粘贴Token\n'
      + '  deepseek_cookie=粘贴Cookie\n\n'
      + '直接粘贴原始值即可，无需转义。',
    buttons: ['确定'],
  })
}

// ── 工具函数 ─────────────────────────────────────────

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') }
function fmtM(n) { return (n / 1e6).toFixed(2) }

function calcCost(prices, model, hit, miss, out) {
  const p = prices[model]
  if (!p) return 0
  return (hit / 1e6) * p.cacheHit + (miss / 1e6) * p.cacheMiss + (out / 1e6) * p.output
}

function getDateStr(daysAgo) {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  return d.toISOString().slice(0, 10)
}

// ── 共享图标 ────────────────────────────────────────

// ── 色彩系统 ────────────────────────────────────────
// 使用 CSS 变量便于全局维护，确保 WCAG AA 对比度
const COLORS = {
  textPrimary: '#1a1a2e',      // 加深主文字，提升对比度
  textSecondary: '#64748b',    // 中性灰，适合辅助信息
  primary: '#4f46e5',          // Indigo 主色调，现代感
  primaryLight: '#818cf8',     // 浅色主色调
  primaryDark: '#3730a3',      // 深色主色调
  success: '#059669',          // Emerald 绿，对比度更好
  warning: '#d97706',          // Amber 橙，对比度达标
  danger: '#dc2626',           // Red 红，对比度达标
  bgLight: '#f8fafc',          // 更中性的背景色
  bgCard: '#ffffff',
  borderLight: '#e2e8f0',     // 柔和边框
  gradientBlue: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #a855f7 100%)',
  gradientSuccess: 'linear-gradient(135deg, #059669 0%, #10b981 100%)',
  gradientWarning: 'linear-gradient(135deg, #d97706 0%, #f59e0b 100%)',
  gradientDanger: 'linear-gradient(135deg, #dc2626 0%, #ef4444 100%)',
}

const ICONS = {
  rocket:  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20"><defs><linearGradient id="g1" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" style="stop-color:#667eea"/><stop offset="100%" style="stop-color:#764ba2"/></linearGradient></defs><path fill="url(#g1)" d="M12 2C12 2 7 7 7 12c0 2.76 2.24 5 5 5s5-2.24 5-5c0-5-5-10-5-10zm0 13c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3z"/><path fill="#ff6b6b" d="M12 17l-2 4h4l-2-4z"/><path fill="#ffd93d" d="M10 21l-1 2h6l-1-2h-4z"/></svg>',
  calendar:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18"><rect x="3" y="4" width="18" height="18" rx="2" fill="#4285f4"/><rect x="3" y="4" width="18" height="5" fill="#1a73e8"/><rect x="7" y="2" width="2" height="4" rx="1" fill="#5f6368"/><rect x="15" y="2" width="2" height="4" rx="1" fill="#5f6368"/><circle cx="8" cy="14" r="1.5" fill="white"/><circle cx="12" cy="14" r="1.5" fill="white"/><circle cx="16" cy="14" r="1.5" fill="white"/><circle cx="8" cy="18" r="1.5" fill="white"/><circle cx="12" cy="18" r="1.5" fill="white"/></svg>',
  chart:   '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18"><rect x="3" y="12" width="4" height="10" rx="1" fill="#34a853"/><rect x="10" y="6" width="4" height="16" rx="1" fill="#4285f4"/><rect x="17" y="9" width="4" height="13" rx="1" fill="#fbbc04"/><path d="M3 8l5-4 4 3 5-5 4 4" stroke="#ea4335" strokeWidth="2" fill="none" strokeLinecap="round"/></svg>',
  money:   '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18"><circle cx="12" cy="12" r="10" fill="#34a853"/><text x="12" y="16" textAnchor="middle" fill="white" fontSize="14" fontWeight="bold">¥</text></svg>',
  bulb:    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18"><path d="M9 21h6v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z" fill="#fbbc04"/></svg>',
  robot:   '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18"><rect x="4" y="8" width="16" height="12" rx="3" fill="#4285f4"/><rect x="6" y="4" width="12" height="6" rx="2" fill="#1a73e8"/><circle cx="9" cy="11" r="2" fill="white"/><circle cx="15" cy="11" r="2" fill="white"/><circle cx="9" cy="11" r="1" fill="#202124"/><circle cx="15" cy="11" r="1" fill="#202124"/><rect x="9" y="15" width="6" height="2" rx="1" fill="white"/></svg>',
  token:   '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16"><circle cx="12" cy="12" r="10" fill="#9c27b0"/><path d="M12 6v12M8 9l4-3 4 3M8 15l4 3 4-3" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round"/></svg>',
  cache:   '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16"><circle cx="12" cy="12" r="10" fill="#009688"/><path d="M8 12l3 3 5-5" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round"/></svg>',
  miss:    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16"><circle cx="12" cy="12" r="10" fill="#ff9800"/><path d="M8 8l8 8M16 8l-8 8" stroke="white" strokeWidth="2" strokeLinecap="round"/></svg>',
  output:  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16"><circle cx="12" cy="12" r="10" fill="#e91e63"/><path d="M12 8v8M8 12l4 4 4-4" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round"/></svg>',
  request: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16"><circle cx="12" cy="12" r="10" fill="#3f51b5"/><path d="M8 12h8M12 8v8" stroke="white" strokeWidth="2" strokeLinecap="round"/></svg>',
  target:  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16"><circle cx="12" cy="12" r="10" fill="none" stroke="#ea4335" strokeWidth="2"/><circle cx="12" cy="12" r="6" fill="none" stroke="#ea4335" strokeWidth="2"/><circle cx="12" cy="12" r="2" fill="#ea4335"/></svg>',
  success: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18"><circle cx="12" cy="12" r="10" fill="#34a853"/><path d="M8 12l3 3 5-5" stroke="white" strokeWidth="2.5" fill="none" strokeLinecap="round"/></svg>',
  warning: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18"><path d="M12 2L2 22h20L12 2z" fill="#fbbc04"/><text x="12" y="18" textAnchor="middle" fill="white" fontSize="14" fontWeight="bold">!</text></svg>',
  danger:  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18"><circle cx="12" cy="12" r="10" fill="#ea4335"/><path d="M8 8l8 8M16 8l-8 8" stroke="white" strokeWidth="2.5" strokeLinecap="round"/></svg>',
  trend:   '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18"><path d="M3 17l4-4 4 4 4-8 6 6" stroke="#34a853" strokeWidth="2.5" fill="none" strokeLinecap="round"/><path d="M17 7h4v4" stroke="#34a853" strokeWidth="2" fill="none" strokeLinecap="round"/></svg>',
  pie:     '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18"><circle cx="12" cy="12" r="10" fill="#4285f4"/><path d="M12 2v10l8.66 5" fill="#1a73e8"/><path d="M12 12l-8.66 5V12z" fill="#34a853"/></svg>',
  diff:    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16"><circle cx="12" cy="12" r="10" fill="#ff9800"/><path d="M12 8v4M12 16h.01" stroke="white" strokeWidth="2" strokeLinecap="round"/></svg>',
}

function icon(name) { return '<span class="icon">' + (ICONS[name] || '') + '</span>' }

// ── 命中率颜色 ──────────────────────────────────────

function hitRateColor(rate) {
  return rate >= 95 ? COLORS.success : rate < 80 ? COLORS.danger : COLORS.warning
}

// ══════════════════════════════════════════════════════
//  共享 HTML 模板构建
// ══════════════════════════════════════════════════════

function buildReportCss(statsCols = 4) {
  const C = COLORS
  return `
/* ═══════════════════════════════════════════════════════
   报告页面样式系统
   - CSS 变量便于维护
   - 响应式设计支持 375px ~ 1440px+
   - 交互反馈和平滑过渡
   - WCAG AA 对比度达标
   ═══════════════════════════════════════════════════════ */

/* ── CSS 变量 ─────────────────────────────────────── */
:root {
  --color-text-primary: ${C.textPrimary};
  --color-text-secondary: ${C.textSecondary};
  --color-primary: ${C.primary};
  --color-primary-light: ${C.primaryLight};
  --color-primary-dark: ${C.primaryDark};
  --color-success: ${C.success};
  --color-warning: ${C.warning};
  --color-danger: ${C.danger};
  --color-bg-light: ${C.bgLight};
  --color-bg-card: ${C.bgCard};
  --color-border: ${C.borderLight};
  --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1);
  --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1);
  --shadow-xl: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-xl: 20px;
  --transition-fast: 150ms cubic-bezier(0.4, 0, 0.2, 1);
  --transition-normal: 250ms cubic-bezier(0.4, 0, 0.2, 1);
  --transition-slow: 350ms cubic-bezier(0.4, 0, 0.2, 1);
  --font-mono: 'SF Mono', 'Cascadia Code', 'Fira Code', Consolas, monospace;
}

/* ── 基础重置 ─────────────────────────────────────── */
*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: "Microsoft YaHei", "Segoe UI", system-ui, -apple-system, sans-serif;
  background: linear-gradient(135deg, #f0f4ff 0%, #e8ecf4 50%, #f0f4ff 100%);
  background-attachment: fixed;
  min-height: 100vh;
  padding: 24px;
  color: var(--color-text-primary);
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* ── 容器 ─────────────────────────────────────────── */
.container {
  max-width: 960px;
  margin: 0 auto;
}

/* ── 头部 ─────────────────────────────────────────── */
.header {
  background: ${C.gradientBlue};
  border-radius: var(--radius-xl);
  padding: 28px 32px;
  margin-bottom: 24px;
  color: #fff;
  box-shadow: var(--shadow-xl), 0 0 0 1px rgba(255, 255, 255, 0.1) inset;
  position: relative;
  overflow: hidden;
}

/* 头部装饰光效 */
.header::before {
  content: '';
  position: absolute;
  top: -50%;
  right: -20%;
  width: 300px;
  height: 300px;
  background: radial-gradient(circle, rgba(255,255,255,0.15) 0%, transparent 70%);
  pointer-events: none;
}

.header-title {
  font-size: 26px;
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: 12px;
  letter-spacing: -0.5px;
  position: relative;
  z-index: 1;
}

.header-date {
  font-size: 14px;
  opacity: .9;
  margin-top: 8px;
  font-weight: 500;
  position: relative;
  z-index: 1;
}

/* ── 卡片 ─────────────────────────────────────────── */
.card {
  background: var(--color-bg-card);
  border-radius: var(--radius-lg);
  padding: 24px;
  margin-bottom: 20px;
  box-shadow: var(--shadow-md);
  border: 1px solid var(--color-border);
  transition: box-shadow var(--transition-normal), transform var(--transition-normal);
}

.card:hover {
  box-shadow: var(--shadow-lg);
  transform: translateY(-2px);
}

.card-title {
  font-size: 17px;
  font-weight: 700;
  color: var(--color-text-primary);
  margin-bottom: 18px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding-bottom: 12px;
  border-bottom: 2px solid var(--color-bg-light);
}

/* ── 统计网格 ─────────────────────────────────────── */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(${statsCols}, 1fr);
  gap: 16px;
  margin-bottom: 20px;
}

.stat-card {
  padding: 20px 16px;
  border-radius: var(--radius-md);
  text-align: center;
  transition: transform var(--transition-fast), box-shadow var(--transition-fast);
  cursor: default;
  position: relative;
  overflow: hidden;
}

.stat-card:hover {
  transform: translateY(-4px);
  box-shadow: var(--shadow-lg);
}

/* 统计卡片装饰 */
.stat-card::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 3px;
  opacity: 0;
  transition: opacity var(--transition-fast);
}

.stat-card:hover::after {
  opacity: 1;
}

.stat-card.blue {
  background: linear-gradient(135deg, #eef2ff 0%, #e0e7ff 100%);
  border: 1px solid #c7d2fe;
}
.stat-card.blue::after { background: var(--color-primary); }

.stat-card.green {
  background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%);
  border: 1px solid #a7f3d0;
}
.stat-card.green::after { background: var(--color-success); }

.stat-card.orange {
  background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%);
  border: 1px solid #fde68a;
}
.stat-card.orange::after { background: var(--color-warning); }

.stat-card.purple {
  background: linear-gradient(135deg, #faf5ff 0%, #f3e8ff 100%);
  border: 1px solid #e9d5ff;
}
.stat-card.purple::after { background: #8b5cf6; }

.stat-label {
  font-size: 13px;
  color: var(--color-text-secondary);
  margin-bottom: 8px;
  font-weight: 500;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.stat-value {
  font-size: 24px;
  font-weight: 700;
  font-family: var(--font-mono);
  letter-spacing: -0.5px;
}

.stat-card.blue .stat-value { color: var(--color-primary); }
.stat-card.green .stat-value { color: var(--color-success); }
.stat-card.orange .stat-value { color: var(--color-warning); }
.stat-card.purple .stat-value { color: #7c3aed; }

/* ── 图表区域 ─────────────────────────────────────── */
.charts-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  margin-bottom: 20px;
}

.chart-container {
  position: relative;
  height: 280px;
  padding: 8px;
}

/* ── 模型卡片 ─────────────────────────────────────── */
.model-card {
  background: var(--color-bg-card);
  border-radius: var(--radius-md);
  padding: 18px;
  margin-bottom: 14px;
  border-left: 4px solid var(--color-primary);
  box-shadow: var(--shadow-sm);
  transition: all var(--transition-normal);
}

.model-card:hover {
  box-shadow: var(--shadow-md);
  transform: translateX(4px);
}

.model-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 14px;
}

.model-name {
  font-weight: 700;
  color: var(--color-primary);
  font-size: 15px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.model-cost {
  font-weight: 700;
  color: var(--color-danger);
  font-family: var(--font-mono);
  font-size: 15px;
}

.model-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}

.model-stat {
  text-align: center;
  padding: 10px 6px;
  background: var(--color-bg-light);
  border-radius: var(--radius-sm);
  transition: background var(--transition-fast);
}

.model-stat:hover {
  background: #e2e8f0;
}

.model-stat-label {
  font-size: 11px;
  color: var(--color-text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  margin-bottom: 4px;
}

.model-stat-value {
  font-size: 14px;
  font-weight: 700;
  font-family: var(--font-mono);
}

/* ── 每日明细 ─────────────────────────────────────── */
.day-header {
  display: grid;
  grid-template-columns: 140px repeat(7, 1fr);
  gap: 6px;
  padding: 12px 16px;
  font-size: 12px;
  color: var(--color-text-secondary);
  font-weight: 600;
  border-bottom: 2px solid var(--color-border);
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.day-h-date { text-align: left; }
.day-h-stat { text-align: center; }

.day-row-detail {
  display: grid;
  grid-template-columns: 140px repeat(7, 1fr);
  gap: 6px;
  padding: 12px 16px;
  border-radius: var(--radius-sm);
  margin-bottom: 6px;
  background: var(--color-bg-light);
  align-items: center;
  font-size: 13px;
  transition: background var(--transition-fast), transform var(--transition-fast);
}

.day-row-detail:hover {
  background: #e2e8f0;
  transform: scale(1.01);
}

.day-stat-cell {
  text-align: center;
  color: var(--color-text-secondary);
  font-family: var(--font-mono);
  font-size: 12px;
}

.day-cost {
  font-weight: 700;
  color: var(--color-danger);
}

.day-official {
  font-weight: 700;
  color: var(--color-success);
}

/* ── 建议区域 ─────────────────────────────────────── */
.suggest {
  padding: 16px 20px;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  gap: 12px;
  font-weight: 500;
  transition: transform var(--transition-fast);
}

.suggest:hover {
  transform: translateX(4px);
}

.suggest-green {
  background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%);
  border: 1px solid #6ee7b7;
  color: #065f46;
}

.suggest-yellow {
  background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%);
  border: 1px solid #fcd34d;
  color: #92400e;
}

.suggest-red {
  background: linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%);
  border: 1px solid #fca5a5;
  color: #991b1b;
}

/* ── Token 使用情况 ───────────────────────────────── */
.token-usage {
  background: linear-gradient(135deg, #eef2ff 0%, #e0e7ff 50%, #eef2ff 100%);
  border: 1px solid #c7d2fe;
  border-radius: var(--radius-lg);
  padding: 20px 24px;
  margin-bottom: 20px;
  display: flex;
  justify-content: space-around;
  align-items: center;
  box-shadow: var(--shadow-sm);
}

.token-item {
  text-align: center;
  transition: transform var(--transition-fast);
}

.token-item:hover {
  transform: scale(1.05);
}

.token-label {
  font-size: 13px;
  color: var(--color-text-secondary);
  margin-bottom: 6px;
  font-weight: 500;
}

.token-value {
  font-size: 20px;
  font-weight: 700;
  font-family: var(--font-mono);
  color: var(--color-primary);
}

.token-raw {
  font-size: 11px;
  color: var(--color-text-secondary);
  font-family: var(--font-mono);
  margin-top: 4px;
  opacity: 0.8;
}

/* ── 图标 ─────────────────────────────────────────── */
.icon {
  display: inline-flex;
  vertical-align: middle;
  transition: transform var(--transition-fast);
}

.icon svg {
  display: block;
}

/* ── 响应式设计 ───────────────────────────────────── */

/* 平板 (768px 以下) */
@media (max-width: 768px) {
  body {
    padding: 16px;
  }

  .header {
    padding: 20px 24px;
    border-radius: var(--radius-lg);
  }

  .header-title {
    font-size: 22px;
  }

  .card {
    padding: 20px;
    border-radius: var(--radius-md);
  }

  .stats-grid {
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
  }

  .charts-grid {
    grid-template-columns: 1fr;
    gap: 16px;
  }

  .chart-container {
    height: 220px;
  }

  .model-stats {
    grid-template-columns: repeat(2, 1fr);
  }

  .day-header,
  .day-row-detail {
    grid-template-columns: 120px repeat(4, 1fr);
    font-size: 11px;
    padding: 10px 12px;
  }

  /* 隐藏部分列在平板上 */
  .day-h-stat:nth-child(6),
  .day-stat-cell:nth-child(6) {
    display: none;
  }

  .token-usage {
    flex-wrap: wrap;
    gap: 16px;
    padding: 16px;
  }

  .token-item {
    flex: 1 1 45%;
    min-width: 120px;
  }
}

/* 手机 (480px 以下) */
@media (max-width: 480px) {
  body {
    padding: 12px;
  }

  .header {
    padding: 16px 20px;
    border-radius: var(--radius-md);
  }

  .header-title {
    font-size: 18px;
    gap: 8px;
  }

  .header-date {
    font-size: 12px;
  }

  .card {
    padding: 16px;
    margin-bottom: 12px;
  }

  .card-title {
    font-size: 15px;
    margin-bottom: 14px;
  }

  .stats-grid {
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }

  .stat-card {
    padding: 14px 12px;
  }

  .stat-value {
    font-size: 20px;
  }

  .stat-label {
    font-size: 11px;
  }

  .chart-container {
    height: 200px;
  }

  .model-card {
    padding: 14px;
  }

  .model-stats {
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  .model-stat {
    padding: 8px 4px;
  }

  .day-header,
  .day-row-detail {
    grid-template-columns: 100px repeat(3, 1fr);
    font-size: 10px;
    padding: 8px 10px;
    gap: 4px;
  }

  /* 隐藏更多列在手机上 */
  .day-h-stat:nth-child(5),
  .day-stat-cell:nth-child(5),
  .day-h-stat:nth-child(6),
  .day-stat-cell:nth-child(6) {
    display: none;
  }

  .token-usage {
    flex-direction: column;
    gap: 12px;
    padding: 14px;
  }

  .token-item {
    width: 100%;
  }

  .token-value {
    font-size: 18px;
  }

  .suggest {
    padding: 12px 16px;
    font-size: 13px;
  }
}

/* 小手机 (375px 以下) */
@media (max-width: 375px) {
  body {
    padding: 10px;
  }

  .header {
    padding: 14px 16px;
  }

  .header-title {
    font-size: 16px;
  }

  .stats-grid {
    grid-template-columns: 1fr;
    gap: 8px;
  }

  .day-header,
  .day-row-detail {
    grid-template-columns: 90px repeat(3, 1fr);
    font-size: 9px;
    padding: 6px 8px;
  }
}

/* 大屏幕优化 (1440px+) */
@media (min-width: 1440px) {
  .container {
    max-width: 1100px;
  }

  .header {
    padding: 32px 40px;
  }

  .header-title {
    font-size: 28px;
  }

  .card {
    padding: 28px;
  }

  .stats-grid {
    gap: 20px;
  }

  .stat-card {
    padding: 24px 20px;
  }

  .stat-value {
    font-size: 26px;
  }

  .chart-container {
    height: 320px;
  }

  .model-stats {
    gap: 12px;
  }

  .day-header,
  .day-row-detail {
    padding: 14px 20px;
  }
}

/* ── 打印优化 ─────────────────────────────────────── */
@media print {
  body {
    background: white;
    padding: 0;
  }

  .card,
  .stat-card,
  .model-card {
    box-shadow: none;
    border: 1px solid #ddd;
  }

  .card:hover,
  .stat-card:hover,
  .model-card:hover {
    transform: none;
  }
}

/* ── 动画关键帧 ───────────────────────────────────── */
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes slideIn {
  from { opacity: 0; transform: translateX(-20px); }
  to { opacity: 1; transform: translateX(0); }
}

.card {
  animation: fadeIn 0.4s ease-out;
}

.stat-card {
  animation: fadeIn 0.4s ease-out;
}

.stat-card:nth-child(1) { animation-delay: 0.05s; }
.stat-card:nth-child(2) { animation-delay: 0.1s; }
.stat-card:nth-child(3) { animation-delay: 0.15s; }
.stat-card:nth-child(4) { animation-delay: 0.2s; }

.model-card {
  animation: slideIn 0.3s ease-out;
}

/* ── 顶部摘要条 ───────────────────────────────────── */
.summary-bar {
  background: linear-gradient(135deg, #f0f4ff 0%, #e8ecf4 100%);
  border: 1px solid #c7d2fe;
  border-radius: var(--radius-lg);
  padding: 16px 24px;
  margin-bottom: 20px;
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 14px;
  color: var(--color-text-primary);
  box-shadow: var(--shadow-sm);
  animation: fadeIn 0.4s ease-out;
}

.summary-bar .summary-icon {
  font-size: 24px;
  flex-shrink: 0;
}

.summary-bar .summary-text {
  flex: 1;
  line-height: 1.6;
}

.summary-bar .summary-text strong {
  color: var(--color-primary);
  font-weight: 700;
}

/* ── 洞察指标卡片 ─────────────────────────────────── */
.insight-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 20px;
}

.insight-card {
  background: var(--color-bg-card);
  border-radius: var(--radius-md);
  padding: 14px 16px;
  border: 1px solid var(--color-border);
  text-align: center;
  transition: all var(--transition-fast);
  animation: fadeIn 0.4s ease-out;
}

.insight-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}

.insight-label {
  font-size: 11px;
  color: var(--color-text-secondary);
  margin-bottom: 6px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.insight-value {
  font-size: 18px;
  font-weight: 700;
  font-family: var(--font-mono);
}

.insight-trend {
  font-size: 11px;
  margin-top: 4px;
  font-weight: 500;
}

.insight-trend.up { color: var(--color-danger); }
.insight-trend.down { color: var(--color-success); }
.insight-trend.neutral { color: var(--color-text-secondary); }

/* ── 模型费用占比条 ───────────────────────────────── */
.model-bar-wrapper {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--color-border);
}

.model-bar-label {
  font-size: 11px;
  color: var(--color-text-secondary);
  margin-bottom: 6px;
}

.model-bar-track {
  height: 6px;
  background: var(--color-bg-light);
  border-radius: 3px;
  overflow: hidden;
}

.model-bar-fill {
  height: 100%;
  border-radius: 3px;
  transition: width var(--transition-slow);
}

/* ── 响应式适配 ───────────────────────────────────── */
@media (max-width: 768px) {
  .summary-bar {
    flex-direction: column;
    text-align: center;
    padding: 14px 16px;
  }

  .insight-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 480px) {
  .summary-bar {
    font-size: 13px;
    padding: 12px 14px;
  }

  .insight-grid {
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  .insight-card {
    padding: 10px 12px;
  }

  .insight-value {
    font-size: 16px;
  }
}

@media (max-width: 375px) {
  .insight-grid {
    grid-template-columns: 1fr;
  }
}

/* ── Tab 切换样式 ─────────────────────────────────── */
.tab-container {
  display: flex;
  gap: 4px;
  background: var(--color-bg-light);
  padding: 6px;
  border-radius: var(--radius-lg);
  margin-bottom: 24px;
  border: 1px solid var(--color-border);
}

.tab-btn {
  flex: 1;
  padding: 12px 20px;
  border: none;
  background: transparent;
  border-radius: var(--radius-md);
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-secondary);
  transition: all var(--transition-normal);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.tab-btn:hover {
  background: rgba(255, 255, 255, 0.8);
  color: var(--color-text-primary);
}

.tab-btn.active {
  background: var(--color-bg-card);
  color: var(--color-primary);
  box-shadow: var(--shadow-md);
}

.tab-btn .tab-icon {
  font-size: 16px;
}

.tab-content {
  display: none;
  animation: fadeIn 0.3s ease-out;
}

.tab-content.active {
  display: block;
}

/* Tab 内的错误提示 */
.tab-error {
  background: linear-gradient(135deg, #fef2f2, #fee2e2);
  border: 1px solid #fca5a5;
  border-radius: var(--radius-lg);
  padding: 40px 24px;
  text-align: center;
  color: #991b1b;
}

.tab-error-icon {
  font-size: 48px;
  margin-bottom: 16px;
}

.tab-error-title {
  font-size: 18px;
  font-weight: 700;
  margin-bottom: 8px;
}

.tab-error-detail {
  font-size: 14px;
  color: #b91c1c;
  margin-bottom: 20px;
}

.tab-error-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  background: #dc2626;
  color: white;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: background var(--transition-fast);
}

.tab-error-btn:hover {
  background: #b91c1c;
}

/* 加载状态 */
.tab-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 24px;
  color: var(--color-text-secondary);
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid var(--color-border);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin-bottom: 16px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 480px) {
  .tab-container {
    flex-direction: column;
    gap: 4px;
  }

  .tab-btn {
    padding: 10px 16px;
  }
}
`
}

function buildReportHeader(title, now) {
  return `<div class="header"><div class="header-title">${icon('rocket')} ${esc(title)}</div><div class="header-date">${icon('calendar')} ${now.toLocaleString()}</div></div>`
}

function buildStatsGrid(cards) {
  let h = '<div class="stats-grid">'
  for (const c of cards) {
    h += `<div class="stat-card ${c.color}">`
    h += `<div class="stat-label">${icon(c.icon)} ${esc(c.label)}</div>`
    h += `<div class="stat-value">${c.value}</div>`
    h += `</div>`
  }
  return h + '</div>'
}

function buildSummaryBar(totalCost, dailyAvg, hitRate, monthlyEstimate) {
  const hitColor = hitRate >= 95 ? COLORS.success : hitRate < 80 ? COLORS.danger : COLORS.warning
  return `<div class="summary-bar">
    <div class="summary-icon">📊</div>
    <div class="summary-text">
      本月已花费 <strong>¥${totalCost.toFixed(2)}</strong>，
      日均 <strong>¥${dailyAvg.toFixed(2)}</strong>，
      缓存命中率 <strong style="color:${hitColor}">${hitRate.toFixed(1)}%</strong>，
      预计全月 <strong>¥${monthlyEstimate.toFixed(2)}</strong>
    </div>
  </div>`
}

function buildInsightCards(dailyData, totalCost, totalRequests) {
  // 计算周环比（使用完整的 dailyData）
  const today = new Date()
  const getDateStr = (daysAgo) => {
    const d = new Date(today)
    d.setDate(d.getDate() - daysAgo)
    return d.toISOString().slice(0, 10)
  }

  let thisWeekCost = 0, lastWeekCost = 0
  for (let i = 0; i < 7; i++) {
    const todayStr = getDateStr(i)
    const lastWeekStr = getDateStr(i + 7)
    thisWeekCost += (dailyData[todayStr]?.cost || 0)
    lastWeekCost += (dailyData[lastWeekStr]?.cost || 0)
  }
  const weekChange = lastWeekCost > 0 ? ((thisWeekCost - lastWeekCost) / lastWeekCost * 100) : (thisWeekCost > 0 ? 9999 : 0)
  const weekTrend = weekChange > 5 ? 'up' : weekChange < -5 ? 'down' : 'neutral'
  const weekIcon = weekChange >= 9999 ? '↑' : weekChange > 0 ? '↑' : weekChange < 0 ? '↓' : '→'
  const weekLabel = weekChange >= 9999 ? '新增消费' : weekChange > 5 ? '费用上升' : weekChange < -5 ? '费用下降' : '基本持平'

  // 平均请求成本
  const avgCost = totalRequests > 0 ? (totalCost / totalRequests) : 0

  // 缓存命中率（最近7天）
  let totalHit = 0, totalMiss = 0
  for (let i = 0; i < 7; i++) {
    const dt = getDateStr(i)
    const day = dailyData[dt]
    if (day) {
      totalHit += day.cacheHit
      totalMiss += day.cacheMiss
    }
  }
  const hitRate = (totalHit + totalMiss) > 0 ? (totalHit / (totalHit + totalMiss) * 100) : 0

  // 峰值日（最近7天）
  let peakDay = ''
  let peakCost = 0
  for (let i = 0; i < 7; i++) {
    const dt = getDateStr(i)
    const day = dailyData[dt]
    if (day && day.cost > peakCost) {
      peakCost = day.cost
      peakDay = dt.slice(5)
    }
  }

  return `<div class="insight-grid">
    <div class="insight-card">
      <div class="insight-label">${icon('trend')} 周环比</div>
      <div class="insight-value" style="color:${weekTrend === 'up' ? COLORS.danger : weekTrend === 'down' ? COLORS.success : COLORS.textPrimary}">${weekIcon} ${weekChange >= 9999 ? '--%' : Math.abs(weekChange).toFixed(1) + '%'}</div>
      <div class="insight-trend ${weekTrend}">${weekLabel}</div>
    </div>
    <div class="insight-card">
      <div class="insight-label">${icon('request')} 均请求成本</div>
      <div class="insight-value" style="color:var(--color-primary)">¥${avgCost.toFixed(4)}</div>
      <div class="insight-trend neutral">每次请求</div>
    </div>
    <div class="insight-card">
      <div class="insight-label">${icon('cache')} 缓存命中率</div>
      <div class="insight-value" style="color:${hitRate >= 95 ? COLORS.success : hitRate < 80 ? COLORS.danger : COLORS.warning}">${hitRate.toFixed(1)}%</div>
      <div class="insight-trend ${hitRate >= 95 ? 'down' : hitRate < 80 ? 'up' : 'neutral'}">${hitRate >= 95 ? '优秀' : hitRate < 80 ? '需优化' : '正常'}</div>
    </div>
    <div class="insight-card">
      <div class="insight-label">${icon('chart')} 峰值日</div>
      <div class="insight-value" style="color:var(--color-warning)">${peakDay || '-'}</div>
      <div class="insight-trend neutral">¥${peakCost.toFixed(2)}</div>
    </div>
  </div>`
}

function buildChartsSection(prefix) {
  // prefix 用于区分不同 Tab 的 canvas ID
  const lineId = prefix ? `${prefix}-lineChart` : 'lineChart'
  const pieId = prefix ? `${prefix}-pieChart` : 'pieChart'
  return `<div class="charts-grid">
<div class="card"><div class="card-title">${icon('chart')} 每日费用趋势</div><div class="chart-container"><canvas id="${lineId}"></canvas></div></div>
<div class="card"><div class="card-title">${icon('pie')} 模型费用占比</div><div class="chart-container"><canvas id="${pieId}"></canvas></div></div></div>`
}

function buildDayDetailRows(sortedDays, today, yesterday, opts = {}) {
  const wk = ['日', '一', '二', '三', '四', '五', '六']
  const showOfficial = !!opts.showOfficial

  let h = `<div class="card"><div class="card-title">${icon('calendar')} 最近7天使用情况</div>`
  h += `<div class="day-header"><span class="day-h-date">日期</span>`
  h += `<span class="day-h-stat">${icon('token')} 总Token</span>`
  h += `<span class="day-h-stat">${icon('cache')} 命中缓存</span>`
  h += `<span class="day-h-stat">${icon('miss')} 未命中</span>`
  h += `<span class="day-h-stat">${icon('output')} 输出</span>`
  h += `<span class="day-h-stat">${icon('target')} 命中率</span>`
  h += `<span class="day-h-stat">${icon('request')} 请求</span>`
  if (showOfficial) h += `<span class="day-h-stat">${icon('money')} 官方计费</span>`
  h += `<span class="day-h-stat">${icon('money')} 费用</span></div>`

  const reversedDays = sortedDays.slice().reverse()
  for (let idx = 0; idx < reversedDays.length; idx++) {
    const [dt, inf] = reversedDays[idx]
    const isToday = dt === today, isYesterday = dt === yesterday
    const dayLabel = isToday ? '📌 今天' : isYesterday ? '昨天' : '周' + wk[new Date(dt).getDay()]
    const dayTotal = inf.cacheHit + inf.cacheMiss + inf.output
    const rate = dayTotal > 0 ? ((inf.cacheHit / dayTotal) * 100) : 0
    const isHighlight = isToday || isYesterday
    const rowStyle = isHighlight ? 'background:linear-gradient(90deg,#eef2ff,#f8fafc);font-weight:500' : ''
    h += `<div class="day-row-detail" style="${rowStyle}">`
    h += `<div class="day-date" style="font-weight:${isHighlight ? '600' : '400'}">${icon('calendar')} ${dt.slice(5)} (${dayLabel})</div>`
    h += `<div class="day-stat-cell">${fmtM(inf.total)}M</div>`
    h += `<div class="day-stat-cell">${fmtM(inf.cacheHit)}M</div>`
    h += `<div class="day-stat-cell">${fmtM(inf.cacheMiss)}M</div>`
    h += `<div class="day-stat-cell">${fmtM(inf.output)}M</div>`
    h += `<div class="day-stat-cell"><strong style="color:${hitRateColor(rate)}">${rate.toFixed(1)}%</strong></div>`
    h += `<div class="day-stat-cell">${inf.requests} 次</div>`
    if (showOfficial) h += `<div class="day-stat-cell day-official">¥${(inf.official || 0).toFixed(4)}</div>`
    h += `<div class="day-stat-cell day-cost">¥${inf.cost.toFixed(4)}</div></div>`
  }
  return h + '</div>'
}

function buildModelDetailCards(modelEntries, opts = {}) {
  // 优化后的模型卡片配色，与设计系统一致
  const modelColors = ['#6366f1', '#059669', '#d97706', '#dc2626', '#8b5cf6', '#0891b2', '#ea580c', '#db2777']
  const showOfficial = !!opts.showOfficial

  let h = `<div class="card"><div class="card-title">${icon('robot')} 各模型本月汇总</div>`
  for (let i = 0; i < modelEntries.length; i++) {
    const [modelName, s] = modelEntries[i]
    const totalTokens = s.cacheHit + s.cacheMiss + s.output
    const rate = totalTokens > 0 ? ((s.cacheHit / totalTokens) * 100) : 0
    const borderColor = modelColors[i % modelColors.length]
    h += `<div class="model-card" style="border-left-color:${borderColor}">`
    h += `<div class="model-header"><div class="model-name" style="color:${borderColor}">${icon('robot')} ${esc(modelName)}</div>`
    h += `<div style="display:flex;align-items:center;gap:8px">`
    if (showOfficial) h += `<span class="model-cost" style="color:${COLORS.success};font-size:13px">官方: ¥${s.official.toFixed(4)}</span>`
    h += `<span class="model-cost">¥${s.cost.toFixed(4)}</span></div></div>`
    h += '<div class="model-stats">'
    h += `<div class="model-stat"><div class="model-stat-label">${icon('cache')} 命中缓存</div><div class="model-stat-value">${fmtM(s.cacheHit)}M</div></div>`
    h += `<div class="model-stat"><div class="model-stat-label">${icon('miss')} 未命中</div><div class="model-stat-value">${fmtM(s.cacheMiss)}M</div></div>`
    h += `<div class="model-stat"><div class="model-stat-label">${icon('output')} 输出</div><div class="model-stat-value">${fmtM(s.output)}M</div></div>`
    h += `<div class="model-stat"><div class="model-stat-label">${icon('request')} 请求</div><div class="model-stat-value">${s.requests} 次</div></div></div>`
    h += `<div style="margin-top:12px;font-size:13px;color:${COLORS.textSecondary};display:flex;align-items:center;gap:6px;padding-top:10px;border-top:1px solid var(--color-border)">${icon('target')} 缓存命中率: <strong style="color:${hitRateColor(rate)};font-size:14px">${rate.toFixed(1)}%</strong></div></div>`
  }
  return h + '</div>'
}

// ── 积分版本的图表和明细（MiMo 套餐专用）──────────────

function buildChartsSectionForToken(prefix) {
  const lineId = prefix ? `${prefix}-lineChart` : 'lineChart'
  const pieId = prefix ? `${prefix}-pieChart` : 'pieChart'
  return `<div class="charts-grid">
<div class="card"><div class="card-title">${icon('chart')} 每日积分趋势</div><div class="chart-container"><canvas id="${lineId}"></canvas></div></div>
<div class="card"><div class="card-title">${icon('pie')} 模型积分占比</div><div class="chart-container"><canvas id="${pieId}"></canvas></div></div></div>`
}

function buildDayDetailRowsForToken(sortedDays, today, yesterday, credits) {
  const wk = ['日', '一', '二', '三', '四', '五', '六']

  let h = `<div class="card"><div class="card-title">${icon('calendar')} 最近7天使用情况</div>`
  h += `<div class="day-header"><span class="day-h-date">日期</span>`
  h += `<span class="day-h-stat">${icon('token')} 总Token</span>`
  h += `<span class="day-h-stat">${icon('cache')} 命中缓存</span>`
  h += `<span class="day-h-stat">${icon('miss')} 未命中</span>`
  h += `<span class="day-h-stat">${icon('output')} 输出</span>`
  h += `<span class="day-h-stat">${icon('target')} 命中率</span>`
  h += `<span class="day-h-stat">${icon('request')} 请求</span>`
  h += `<span class="day-h-stat">${icon('token')} 积分消耗</span></div>`

  const reversedDays = sortedDays.slice().reverse()
  for (let idx = 0; idx < reversedDays.length; idx++) {
    const [dt, inf] = reversedDays[idx]
    const isToday = dt === today, isYesterday = dt === yesterday
    const dayLabel = isToday ? '📌 今天' : isYesterday ? '昨天' : '周' + wk[new Date(dt).getDay()]
    const dayTotal = inf.cacheHit + inf.cacheMiss + inf.output
    const rate = dayTotal > 0 ? ((inf.cacheHit / dayTotal) * 100) : 0
    const isHighlight = isToday || isYesterday
    const rowStyle = isHighlight ? 'background:linear-gradient(90deg,#eef2ff,#f8fafc);font-weight:500' : ''
    h += `<div class="day-row-detail" style="${rowStyle}">`
    h += `<div class="day-date" style="font-weight:${isHighlight ? '600' : '400'}">${icon('calendar')} ${dt.slice(5)} (${dayLabel})</div>`
    h += `<div class="day-stat-cell">${fmtM(inf.total)}M</div>`
    h += `<div class="day-stat-cell">${fmtM(inf.cacheHit)}M</div>`
    h += `<div class="day-stat-cell">${fmtM(inf.cacheMiss)}M</div>`
    h += `<div class="day-stat-cell">${fmtM(inf.output)}M</div>`
    h += `<div class="day-stat-cell"><strong style="color:${hitRateColor(rate)}">${rate.toFixed(1)}%</strong></div>`
    h += `<div class="day-stat-cell">${inf.requests} 次</div>`
    const dc = credits ? (credits[inf.model] || credits['mimo-v2.5']) : null
    const dayCredits = dc ? (inf.cacheHit * dc.cacheHit + inf.cacheMiss * dc.cacheMiss + inf.output * dc.output) : inf.total
    h += `<div class="day-stat-cell" style="font-weight:bold;color:var(--color-primary)">${fmtM(dayCredits)}M</div></div>`
  }
  return h + '</div>'
}

function buildModelDetailCardsForToken(modelEntries) {
  const modelColors = ['#6366f1', '#059669', '#d97706', '#dc2626', '#8b5cf6', '#0891b2', '#ea580c', '#db2777']

  let h = `<div class="card"><div class="card-title">${icon('robot')} 各模型本月汇总</div>`
  for (let i = 0; i < modelEntries.length; i++) {
    const [modelName, s] = modelEntries[i]
    const totalTokens = s.cacheHit + s.cacheMiss + s.output
    const rate = totalTokens > 0 ? ((s.cacheHit / totalTokens) * 100) : 0
    const borderColor = modelColors[i % modelColors.length]
    h += `<div class="model-card" style="border-left-color:${borderColor}">`
    h += `<div class="model-header"><div class="model-name" style="color:${borderColor}">${icon('robot')} ${esc(modelName)}</div>`
    h += `<div style="display:flex;align-items:center;gap:8px">`
    h += `<span class="model-cost" style="color:var(--color-primary)">${fmtM(totalTokens)}M</span></div></div>`
    h += '<div class="model-stats">'
    h += `<div class="model-stat"><div class="model-stat-label">${icon('cache')} 命中缓存</div><div class="model-stat-value">${fmtM(s.cacheHit)}M</div></div>`
    h += `<div class="model-stat"><div class="model-stat-label">${icon('miss')} 未命中</div><div class="model-stat-value">${fmtM(s.cacheMiss)}M</div></div>`
    h += `<div class="model-stat"><div class="model-stat-label">${icon('output')} 输出</div><div class="model-stat-value">${fmtM(s.output)}M</div></div>`
    h += `<div class="model-stat"><div class="model-stat-label">${icon('request')} 请求</div><div class="model-stat-value">${s.requests} 次</div></div></div>`
    h += `<div style="margin-top:12px;font-size:13px;color:${COLORS.textSecondary};display:flex;align-items:center;gap:6px;padding-top:10px;border-top:1px solid var(--color-border)">${icon('target')} 缓存命中率: <strong style="color:${hitRateColor(rate)};font-size:14px">${rate.toFixed(1)}%</strong></div></div>`
  }
  return h + '</div>'
}

function buildChartScriptForToken(chartLabels, chartTokens, chartRequests, modelNames, modelTokens, totalTokens, prefix) {
  const lineId = prefix ? `${prefix}-lineChart` : 'lineChart'
  const pieId = prefix ? `${prefix}-pieChart` : 'pieChart'

  const modelColors = ['#6366f1', '#059669', '#d97706', '#dc2626', '#8b5cf6', '#0891b2', '#ea580c', '#db2777']
  const lineDatasets = [
    `{label:"每日积分消耗 (M)",data:${JSON.stringify(chartTokens)},borderColor:"#6366f1",backgroundColor:"rgba(99,102,241,.1)",borderWidth:3,fill:true,tension:.4,pointBackgroundColor:"#6366f1",pointBorderColor:"#fff",pointBorderWidth:2,pointRadius:5,pointHoverRadius:7}`,
  ]
  if (chartRequests) {
    lineDatasets.push(`{label:"请求次数",data:${JSON.stringify(chartRequests)},borderColor:"#059669",backgroundColor:"rgba(5,150,105,.1)",borderWidth:2,fill:false,tension:.4,pointBackgroundColor:"#059669",pointBorderColor:"#fff",pointBorderWidth:2,pointRadius:4,pointHoverRadius:6,yAxisID:"y1"}`)
  }

  const yScales = chartRequests
    ? `y:{beginAtZero:true,title:{display:true,text:"积分 (M)",font:{size:12,weight:'bold'}},grid:{color:'rgba(0,0,0,.06)'}},y1:{position:"right",beginAtZero:true,title:{display:true,text:"请求次数",font:{size:12,weight:'bold'}},grid:{drawOnChartArea:false}}`
    : `y:{beginAtZero:true,title:{display:true,text:"积分 (M)",font:{size:12,weight:'bold'}},grid:{color:'rgba(0,0,0,.06)'}}`

  let s = ''
  s += `new Chart(document.getElementById("${lineId}"),{type:"line",data:{labels:${JSON.stringify(chartLabels)},datasets:[${lineDatasets.join(',')}]},options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{position:"top",labels:{usePointStyle:true,padding:16,font:{size:12}}},tooltip:{backgroundColor:'rgba(26,26,46,.9)',titleFont:{size:13},bodyFont:{size:12},padding:12,cornerRadius:8,displayColors:true}},scales:{x:{grid:{display:false},ticks:{font:{size:11}}},${yScales}}}});`
  s += `new Chart(document.getElementById("${pieId}"),{type:"doughnut",data:{labels:${JSON.stringify(modelNames)},datasets:[{data:${JSON.stringify(modelTokens)},backgroundColor:${JSON.stringify(modelColors.slice(0, modelNames.length))},borderWidth:3,borderColor:"#fff",hoverOffset:12,hoverBorderWidth:4}]},options:{responsive:true,maintainAspectRatio:false,cutout:'55%',plugins:{legend:{position:"bottom",labels:{usePointStyle:true,padding:14,font:{size:11}}},tooltip:{backgroundColor:'rgba(26,26,46,.9)',titleFont:{size:13},bodyFont:{size:12},padding:12,cornerRadius:8,callbacks:{label:function(ctx){return ctx.label+": "+ctx.parsed+"M ("+((ctx.parsed/${totalTokens})*100).toFixed(1)+"%)"}}}}}});`
  return s
}

function buildChartScript(chartLabels, chartCosts, chartRequests, modelNames, modelCosts, totalCost, extraDatasets, prefix) {
  // prefix 用于区分不同 Tab 的 canvas ID
  const lineId = prefix ? `${prefix}-lineChart` : 'lineChart'
  const pieId = prefix ? `${prefix}-pieChart` : 'pieChart'

  // 优化后的图表配色，与整体设计系统协调
  const modelColors = ['#6366f1', '#059669', '#d97706', '#dc2626', '#8b5cf6', '#0891b2', '#ea580c', '#db2777']
  const lineDatasets = [
    `{label:"每日费用 (¥)",data:${JSON.stringify(chartCosts)},borderColor:"#6366f1",backgroundColor:"rgba(99,102,241,.1)",borderWidth:3,fill:true,tension:.4,pointBackgroundColor:"#6366f1",pointBorderColor:"#fff",pointBorderWidth:2,pointRadius:5,pointHoverRadius:7}`,
  ]
  if (chartRequests) {
    lineDatasets.push(`{label:"请求次数",data:${JSON.stringify(chartRequests)},borderColor:"#059669",backgroundColor:"rgba(5,150,105,.1)",borderWidth:2,fill:false,tension:.4,pointBackgroundColor:"#059669",pointBorderColor:"#fff",pointBorderWidth:2,pointRadius:4,pointHoverRadius:6,yAxisID:"y1"}`)
  }
  if (extraDatasets) {
    lineDatasets.push(...extraDatasets)
  }

  const yScales = chartRequests
    ? `y:{beginAtZero:true,title:{display:true,text:"费用 (¥)",font:{size:12,weight:'bold'}},grid:{color:'rgba(0,0,0,.06)'}},y1:{position:"right",beginAtZero:true,title:{display:true,text:"请求次数",font:{size:12,weight:'bold'}},grid:{drawOnChartArea:false}}`
    : `y:{beginAtZero:true,title:{display:true,text:"费用 (¥)",font:{size:12,weight:'bold'}},grid:{color:'rgba(0,0,0,.06)'}}`

  // 返回纯函数体（不包含 script 标签），由调用方决定如何包装
  let s = ''
  // 折线图配置
  s += `new Chart(document.getElementById("${lineId}"),{type:"line",data:{labels:${JSON.stringify(chartLabels)},datasets:[${lineDatasets.join(',')}]},options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{position:"top",labels:{usePointStyle:true,padding:16,font:{size:12}}},tooltip:{backgroundColor:'rgba(26,26,46,.9)',titleFont:{size:13},bodyFont:{size:12},padding:12,cornerRadius:8,displayColors:true}},scales:{x:{grid:{display:false},ticks:{font:{size:11}}},${yScales}}}});`
  // 饼图配置
  s += `new Chart(document.getElementById("${pieId}"),{type:"doughnut",data:{labels:${JSON.stringify(modelNames)},datasets:[{data:${JSON.stringify(modelCosts)},backgroundColor:${JSON.stringify(modelColors.slice(0, modelNames.length))},borderWidth:3,borderColor:"#fff",hoverOffset:12,hoverBorderWidth:4}]},options:{responsive:true,maintainAspectRatio:false,cutout:'55%',plugins:{legend:{position:"bottom",labels:{usePointStyle:true,padding:14,font:{size:11}}},tooltip:{backgroundColor:'rgba(26,26,46,.9)',titleFont:{size:13},bodyFont:{size:12},padding:12,cornerRadius:8,callbacks:{label:function(ctx){return ctx.label+": ¥"+ctx.parsed+" ("+((ctx.parsed/${totalCost})*100).toFixed(1)+"%)"}}}}}});`
  return s
}

function wrapReport(css, bodyHtml, scriptHtml) {
  return `<!DOCTYPE html><html lang="zh-CN"><head>`
    + `<meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">`
    + `<title>用量报告</title>`
    + `<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>`
    + `<style>${css}</style>`
    + `</head><body>`
    + `<div class="container">`
    + bodyHtml
    + `</div>${scriptHtml}</body></html>`
}

// ── 加载占位符 ──────────────────────────────────────

function buildLoadingPlaceholder() {
  return `<div class="tab-loading">
    <div class="loading-spinner"></div>
    <div>点击加载数据...</div>
  </div>`
}

function wrapUnifiedReport(css, tabs, firstTabScript) {
  // tabs: [{id, label, icon, content}]
  const tabButtons = tabs.map((tab, i) =>
    `<button class="tab-btn ${i === 0 ? 'active' : ''}" onclick="switchTab('${tab.id}', this)">
      <span class="tab-icon">${tab.icon}</span>
      ${tab.label}
    </button>`
  ).join('')

  const tabContents = tabs.map((tab, i) =>
    `<div id="tab-${tab.id}" class="tab-content ${i === 0 ? 'active' : ''}">${tab.content}</div>`
  ).join('')

  const switchTabScript = `
    // 已加载的 tab 集合
    const loadedTabs = new Set(['${tabs[0].id}']);

    function switchTab(tabId, btn) {
      // 隐藏所有 tab 内容
      document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'))
      // 移除所有 tab 激活状态
      document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'))
      // 显示目标 tab
      document.getElementById('tab-' + tabId).classList.add('active')
      // 激活对应按钮
      btn.classList.add('active')

      // 懒加载：首次切换时通过 IPC 请求数据
      if (!loadedTabs.has(tabId)) {
        loadTabData(tabId);
      } else {
        window.dispatchEvent(new Event('resize'));
      }
    }

    function loadTabData(tabId) {
      const container = document.getElementById('tab-' + tabId);
      container.innerHTML = '<div class="tab-loading"><div class="loading-spinner"></div><div>加载中...</div></div>';

      if (window.reportAPI && window.reportAPI.loadTab) {
        window.reportAPI.loadTab(tabId).then(function(result) {
          if (result.error) {
            container.innerHTML = buildErrorHtml(result.error, result.detail);
          } else {
            container.innerHTML = result.content;
            loadedTabs.add(tabId);
            // 执行图表初始化脚本
            if (result.script) {
              try { new Function(result.script)(); } catch(e) { console.error('Chart script error:', e); }
            }
          }
        }).catch(function(err) {
          container.innerHTML = buildErrorHtml('加载失败', err.message || '未知错误');
        });
      } else {
        container.innerHTML = buildErrorHtml('API 不可用', 'preload 脚本未正确加载');
      }
    }

    function buildErrorHtml(error, detail) {
      return '<div class="tab-error">'
        + '<div class="tab-error-icon">⚠️</div>'
        + '<div class="tab-error-title">' + error + '</div>'
        + '<div class="tab-error-detail">' + (detail || '') + '</div>'
        + '</div>';
    }

    // 初始化第一个 tab 的图表
    document.addEventListener('DOMContentLoaded', function() {
      ${firstTabScript || ''}
    });
  `

  return `<!DOCTYPE html><html lang="zh-CN"><head>`
    + `<meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">`
    + `<title>AI 用量报告</title>`
    + `<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>`
    + `<style>${css}</style>`
    + `</head><body>`
    + `<div class="container">`
    + `<div class="header"><div class="header-title">${icon('rocket')} AI 用量报告</div><div class="header-date">${icon('calendar')} ${new Date().toLocaleString()}</div></div>`
    + `<div class="tab-container">${tabButtons}</div>`
    + tabContents
    + `</div>`
    + `<script>${switchTabScript}</script>`
    + `</body></html>`
}

// ── 弹窗展示 HTML 报告 ──────────────────────────────

function openHtmlReport(html, filename, title, opts) {
  const { BrowserWindow, app, nativeImage } = require('electron')
  const filePath = path.join(os.tmpdir(), filename)
  fs.writeFileSync(filePath, html, 'utf-8')

  // 获取图标，使用 nativeImage 加载（与主窗口一致）
  let icon
  try {
    const isPackaged = app.isPackaged
    const resourcesPath = process.resourcesPath
    const appDir = path.join(__dirname, '..')
    let iconPath
    if (process.platform === 'win32') {
      if (isPackaged) {
        iconPath = [
          path.join(resourcesPath, 'icon.ico'),
          path.join(resourcesPath, 'app.asar.unpacked', 'assets', 'icon.ico'),
          path.join(resourcesPath, 'app.asar', 'assets', 'icon.ico'),
          path.join(resourcesPath, 'app.asar.unpacked', 'assets', 'icons', '256x256.png'),
          path.join(resourcesPath, 'app.asar', 'assets', 'icons', '256x256.png'),
        ].find(p => { try { return fs.existsSync(p) } catch { return false } })
      } else {
        iconPath = [
          path.join(appDir, 'assets', 'icon.ico'),
          path.join(appDir, 'assets', 'icons', '256x256.png'),
        ].find(p => { try { return fs.existsSync(p) } catch { return false } })
      }
    }
    if (iconPath) {
      icon = nativeImage.createFromPath(iconPath)
      console.log('[Report] Icon loaded:', iconPath, '| size:', icon.getSize())
    }
  } catch (e) { console.error('[Report] Icon error:', e) }

  const winOpts = {
    width: 940,
    height: 720,
    title: title || '用量报告',
    autoHideMenuBar: true,
    minimizable: false,
    maximizable: false,
    resizable: true,
    webPreferences: { contextIsolation: true, sandbox: true, ...(opts?.webPreferences || {}) },
  }
  if (icon) winOpts.icon = icon

  const win = new BrowserWindow(winOpts)
  // 窗口创建后再次设置图标（解决 Windows 任务栏图标缓存问题）
  if (icon) {
    try { win.setIcon(icon) } catch (e) { console.error('[Report] setIcon error:', e) }
  }
  win.loadFile(filePath)
  win.on('closed', () => {
    try { fs.unlinkSync(filePath) } catch {}
  })
}

// ── 生成单个 Tab 的报告内容 ─────────────────────────

async function buildMimoPlanTab(cfg, now, today, yesterday, monthStr) {
  const mimoCfg = cfg.mimo || {}
  const COOKIE = mimoCfg.cookie || ''
  const PRICES = mimoCfg.prices || DEFAULT_PRICES.mimo

  if (!COOKIE.trim()) {
    return { error: '请先配置 MiMo Cookie', detail: '点击右上角菜单 → 配置，填入 MiMo Cookie' }
  }

  const y = now.getFullYear(), mo = now.getMonth() + 1
  const ph = (COOKIE.match(/api-platform_ph="?([^";]+)"?/) || [])[1] || ''
  const commonHeaders = getMimoCommonHeaders(COOKIE)

  // 获取积分使用情况
  let tokenUsage = { totalLimit: 0, totalUsed: 0, percent: 0 }
  try {
    const usageRes = await httpsGet('platform.xiaomimimo.com', '/api/v1/tokenPlan/usage',
      { ...commonHeaders, Referer: 'https://platform.xiaomimimo.com/console/plan-manage' }
    )
    if (usageRes.code === 0 && usageRes.data?.usage?.items) {
      const items = usageRes.data.usage.items
      tokenUsage.totalLimit = items.reduce((sum, item) => sum + (item.limit || 0), 0)
      tokenUsage.totalUsed = items.reduce((sum, item) => sum + (item.used || 0), 0)
      tokenUsage.percent = tokenUsage.totalLimit > 0 ? (tokenUsage.totalUsed / tokenUsage.totalLimit * 100) : 0
    }
  } catch {}

  const apiPath = '/api/v1/usage/token-plan/list'
  let data = await fetchMimoData(COOKIE, ph, commonHeaders, apiPath, y, mo)
  try {
    const prevData = await fetchMimoData(COOKIE, ph, commonHeaders, apiPath, mo === 1 ? y - 1 : y, mo === 1 ? 12 : mo - 1)
    data = prevData.concat(data)
  } catch {}

  const { dailyData, modelData, totalCost } = aggregateDailyAndModel(data, monthStr, r => calcCost(PRICES, r.model, r.cacheHit, r.cacheMiss, r.output))
  for (const v of Object.values(dailyData)) v.official = 0
  for (const v of Object.values(modelData)) v.official = 0
  const { sortedDays, chartLabels, chartCosts, chartRequests, modelEntries, modelNames, modelCosts } = buildChartData(dailyData, modelData)

  let _workdays = 0
  for (let _d = 1; _d <= now.getDate(); _d++) {
    const _dow = new Date(now.getFullYear(), now.getMonth(), _d).getDay()
    if (_dow !== 0 && _dow !== 6) _workdays++
  }
  const daysPassed = _workdays || 1
  const dailyAvg = totalCost / daysPassed
  const monthlyEstimate = dailyAvg * 22
  const totalRequests = sortedDays.reduce((sum, d) => sum + d[1].requests, 0)
  const totalHit = sortedDays.reduce((sum, d) => sum + d[1].cacheHit, 0)
  const totalMiss = sortedDays.reduce((sum, d) => sum + d[1].cacheMiss, 0)
  const hitRate = (totalHit + totalMiss) > 0 ? (totalHit / (totalHit + totalMiss) * 100) : 0

  const percentColor = tokenUsage.percent >= 80 ? COLORS.danger : tokenUsage.percent >= 50 ? COLORS.warning : COLORS.success

  // 计算积分相关指标
  const remainingTokens = tokenUsage.totalLimit - tokenUsage.totalUsed
  const remainingPercent = tokenUsage.totalLimit > 0 ? (remainingTokens / tokenUsage.totalLimit * 100) : 0
  const dailyTokenAvg = tokenUsage.totalUsed / (daysPassed || 1)
  const monthlyTokenEstimate = dailyTokenAvg * 22

  // 摘要条使用积分维度
  const remainingColor = remainingPercent <= 20 ? COLORS.danger : remainingPercent <= 50 ? COLORS.warning : COLORS.success
  const summaryText = `套餐积分 <strong>${fmtM(tokenUsage.totalLimit)}M</strong>，已使用 <strong>${fmtM(tokenUsage.totalUsed)}M</strong>，剩余 <strong style="color:${remainingColor}">${fmtM(remainingTokens)}M</strong>，使用率 <strong style="color:${percentColor}">${tokenUsage.percent.toFixed(1)}%</strong>`
  let body = `<div class="summary-bar"><div class="summary-icon">📊</div><div class="summary-text">${summaryText}</div></div>`

  // 统计卡片（第一行）
  const daysRemaining = dailyTokenAvg > 0 ? Math.floor(remainingTokens / dailyTokenAvg) : '-'
  body += buildStatsGrid([
    { color: 'green', icon: 'token', label: '剩余积分', value: fmtM(remainingTokens) + 'M' },
    { color: 'blue', icon: 'chart', label: '预计可用天数', value: daysRemaining === '-' ? '-' : daysRemaining + ' 天' },
    { color: 'orange', icon: 'trend', label: '日均积分使用', value: fmtM(dailyTokenAvg) + 'M' },
    { color: 'purple', icon: 'target', label: '全月预估', value: fmtM(monthlyTokenEstimate) + 'M' },
  ])

  // 洞察卡片（积分维度）
  const totalTokenUsage = sortedDays.reduce((sum, d) => sum + d[1].total, 0)
  const avgRequestToken = totalRequests > 0 ? (totalTokenUsage / totalRequests) : 0

  // 计算周环比（按自然周对比，周一→周日）
  const wowDow = now.getDay()
  const wowMonOff = wowDow === 0 ? -6 : 1 - wowDow
  const wowDays = wowDow === 0 ? 7 : wowDow
  let thisWeekToken = 0, lastWeekToken = 0
  for (let i = 0; i < wowDays; i++) {
    const d = new Date(now)
    d.setDate(now.getDate() + wowMonOff + i)
    const todayStr = d.toISOString().slice(0, 10)
    const lastD = new Date(d)
    lastD.setDate(lastD.getDate() - 7)
    const lastWeekStr = lastD.toISOString().slice(0, 10)
    thisWeekToken += (dailyData[todayStr]?.total || 0)
    lastWeekToken += (dailyData[lastWeekStr]?.total || 0)
  }
  const weekTokenChange = lastWeekToken > 0 ? ((thisWeekToken - lastWeekToken) / lastWeekToken * 100) : (thisWeekToken > 0 ? 9999 : 0)
  const weekTokenTrend = weekTokenChange > 5 ? 'up' : weekTokenChange < -5 ? 'down' : 'neutral'
  const weekTokenIcon = weekTokenChange >= 9999 ? '🆕' : weekTokenChange > 0 ? '↑' : weekTokenChange < 0 ? '↓' : '→'
  const weekTokenLabel = weekTokenChange >= 9999 ? '新增消耗' : weekTokenChange > 5 ? '消耗上升' : weekTokenChange < -5 ? '消耗下降' : '基本持平'

  // 峰值日（最近7天，积分维度）
  const getDateStr = (daysAgo) => {
    const d = new Date()
    d.setDate(d.getDate() - daysAgo)
    return d.toISOString().slice(0, 10)
  }
  let peakTokenDay = ''
  let peakTokenCost = 0
  for (let i = 0; i < 7; i++) {
    const dt = getDateStr(i)
    const day = dailyData[dt]
    if (day && day.total > peakTokenCost) {
      peakTokenCost = day.total
      peakTokenDay = dt.slice(5)
    }
  }

  // 全月预估是否超标
  const isOverLimit = monthlyTokenEstimate > tokenUsage.totalLimit

  body += `<div class="insight-grid">
    <div class="insight-card">
      <div class="insight-label">${icon('trend')} 周环比(积分)</div>
      <div class="insight-value" style="color:${weekTokenTrend === 'up' ? COLORS.danger : weekTokenTrend === 'down' ? COLORS.success : COLORS.textPrimary}">${weekTokenIcon} ${weekTokenChange >= 9999 ? '--%' : Math.abs(weekTokenChange).toFixed(1) + '%'}</div>
      <div class="insight-trend ${weekTokenTrend}">${weekTokenLabel}</div>
    </div>
    <div class="insight-card">
      <div class="insight-label">${icon('request')} 均请求积分</div>
      <div class="insight-value" style="color:var(--color-primary)">${fmtM(avgRequestToken)}M</div>
      <div class="insight-trend neutral">每次请求</div>
    </div>
    <div class="insight-card">
      <div class="insight-label">${icon('cache')} 缓存命中率</div>
      <div class="insight-value" style="color:${hitRate >= 95 ? COLORS.success : hitRate < 80 ? COLORS.danger : COLORS.warning}">${hitRate.toFixed(1)}%</div>
      <div class="insight-trend ${hitRate >= 95 ? 'down' : hitRate < 80 ? 'up' : 'neutral'}">${hitRate >= 95 ? '优秀' : hitRate < 80 ? '需优化' : '正常'}</div>
    </div>
    <div class="insight-card">
      <div class="insight-label">${icon('chart')} 峰值日</div>
      <div class="insight-value" style="color:var(--color-warning)">${peakTokenDay || '-'}</div>
      <div class="insight-trend neutral">${peakTokenCost > 0 ? fmtM(peakTokenCost) + 'M' : '-'}</div>
    </div>
  </div>`

  // 全月预估超标警告（显示预计使用到哪一天）
  if (isOverLimit && dailyTokenAvg > 0) {
    const workdaysLeft = Math.floor(remainingTokens / dailyTokenAvg)
    const todayObj = new Date(today)
    const exhaustDate = new Date(todayObj)
    let added = 0
    while (added < workdaysLeft) {
      exhaustDate.setDate(exhaustDate.getDate() + 1)
      const dow = exhaustDate.getDay()
      if (dow !== 0 && dow !== 6) added++
    }
    const exhaustMonth = exhaustDate.getMonth() + 1
    const exhaustDay = exhaustDate.getDate()
    body += `<div class="suggest suggest-red" style="margin-bottom:16px;flex-direction:column;align-items:flex-start;gap:4px">
      <div>${icon('danger')} 按当前日均消耗，预计 <strong>${exhaustMonth}月${exhaustDay}号</strong> 用尽套餐积分</div>
      <div style="font-size:13px;opacity:.9">💡 建议控制使用量或升级套餐</div>
    </div>`
  }

  // Credits 换算公式（用于每日明细的积分消耗列）
  const CREDITS = {
    'mimo-v2.5':     { cacheHit: 2,   cacheMiss: 100, output: 200 },
    'mimo-v2.5-pro': { cacheHit: 2.5, cacheMiss: 300, output: 600 },
  }

  body += buildChartsSectionForToken('mimo-plan')
  body += buildDayDetailRowsForToken(sortedDays, today, yesterday, CREDITS)
  body += buildModelDetailCardsForToken(modelEntries)

  // 图表数据（积分维度）
  const chartTokens = sortedDays.map(d => +(d[1].total / 1e6).toFixed(4))
  const modelTokens = modelEntries.map(e => (e[1].cacheHit + e[1].cacheMiss + e[1].output) / 1e6)
  const totalTokensM = totalTokenUsage / 1e6

  const script = buildChartScriptForToken(chartLabels, chartTokens, chartRequests, modelNames, modelTokens, totalTokensM, 'mimo-plan')
  return { content: body, script }
}

async function buildMimoPaygTab(cfg, now, today, yesterday, monthStr) {
  const mimoCfg = cfg.mimo || {}
  const COOKIE = mimoCfg.cookie || ''

  if (!COOKIE.trim()) {
    return { error: '请先配置 MiMo Cookie', detail: '点击右上角菜单 → 配置，填入 MiMo Cookie' }
  }

  const y = now.getFullYear(), mo = now.getMonth() + 1
  const ph = (COOKIE.match(/api-platform_ph="?([^";]+)"?/) || [])[1] || ''
  const commonHeaders = getMimoCommonHeaders(COOKIE)

  let balance = 0
  try {
    const balanceRes = await httpsGet('platform.xiaomimimo.com', '/api/v1/balance', commonHeaders)
    if (balanceRes.code === 0) balance = parseFloat(balanceRes.data?.balance) || 0
  } catch {}

  let data = await fetchMimoPaygData(COOKIE, ph, commonHeaders, y, mo)
  try {
    const prevMo = mo === 1 ? 12 : mo - 1, prevY = mo === 1 ? y - 1 : y
    const prevRes = await httpsPost('platform.xiaomimimo.com', '/api/v1/usage/detail/list' + '?api-platform_ph=' + encodeURIComponent(ph),
      { year: prevY, month: prevMo },
      { ...commonHeaders, Referer: 'https://platform.xiaomimimo.com/console/usage' }
    )
    if (prevRes.code === 0) {
      const prevData = (prevRes.data || []).map(i => ({
        date: i.date, model: i.model, total: i.totalToken || 0,
        cacheHit: i.inputHitToken || 0, cacheMiss: i.inputMissToken || 0,
        output: i.outputToken || 0, requests: i.requestCount || 0,
        cost: parseFloat(i.consumedAmount) || 0,
      }))
      data = prevData.concat(data)
    }
  } catch {}

  const { dailyData, modelData, totalCost } = aggregateDailyAndModel(data, monthStr, r => r.cost)
  for (const v of Object.values(dailyData)) v.official = 0
  for (const v of Object.values(modelData)) v.official = 0
  const { sortedDays, chartLabels, chartCosts, chartRequests, modelEntries, modelNames, modelCosts } = buildChartData(dailyData, modelData)

  let _workdays = 0
  for (let _d = 1; _d <= now.getDate(); _d++) {
    const _dow = new Date(now.getFullYear(), now.getMonth(), _d).getDay()
    if (_dow !== 0 && _dow !== 6) _workdays++
  }
  const daysPassed = _workdays || 1
  const dailyAvg = totalCost / daysPassed
  const monthlyEstimate = dailyAvg * 22
  const totalRequests = sortedDays.reduce((sum, d) => sum + d[1].requests, 0)
  const totalHit = sortedDays.reduce((sum, d) => sum + d[1].cacheHit, 0)
  const totalMiss = sortedDays.reduce((sum, d) => sum + d[1].cacheMiss, 0)
  const hitRate = (totalHit + totalMiss) > 0 ? (totalHit / (totalHit + totalMiss) * 100) : 0

  let body = buildSummaryBar(totalCost, dailyAvg, hitRate, monthlyEstimate)
  body += buildStatsGrid([
    { color: 'purple', icon: 'money', label: '账户余额', value: '¥' + balance.toFixed(2) },
    { color: 'blue', icon: 'money', label: '本月总费用', value: '¥' + totalCost.toFixed(2) },
    { color: 'green', icon: 'chart', label: '日均费用', value: '¥' + dailyAvg.toFixed(2) },
    { color: 'orange', icon: 'trend', label: '全月预估(22天)', value: '¥' + monthlyEstimate.toFixed(2) },
  ])
  body += buildInsightCards(dailyData, totalCost, totalRequests)
  body += buildChartsSection('mimo-payg')
  body += buildDayDetailRows(sortedDays, today, yesterday)
  body += buildModelDetailCards(modelEntries)

  body += `<div class="card"><div class="card-title">${icon('bulb')} 智能建议</div>`
  if (monthlyEstimate >= 34.32) {
    body += `<div class="suggest suggest-red">${icon('danger')} 建议购买 Lite 套餐 (¥34.32/月)，可节省费用</div>`
  } else if (monthlyEstimate >= 20) {
    body += `<div class="suggest suggest-yellow">${icon('warning')} 接近套餐阈值，可考虑购买套餐</div>`
  } else {
    body += `<div class="suggest suggest-green">${icon('success')} 继续按量付费更划算</div>`
  }
  body += '</div>'

  const script = buildChartScript(chartLabels, chartCosts, chartRequests, modelNames, modelCosts, totalCost, null, 'mimo-payg')
  return { content: body, script }
}

async function buildDeepseekTab(cfg, now, today, yesterday, monthStr) {
  const dsCfg = cfg.deepseek || {}
  const AUTH_TOKEN = dsCfg.authToken || ''
  const COOKIE = dsCfg.cookie || ''
  const PRICES = dsCfg.prices || DEFAULT_PRICES.deepseek

  if (!AUTH_TOKEN.trim()) {
    return { error: '请先配置 DeepSeek Auth Token', detail: '点击右上角菜单 → 配置，填入 DeepSeek Auth Token' }
  }

  const y = now.getFullYear(), mo = now.getMonth() + 1
  const dsHeaders = {
    'accept': '*/*', 'authorization': 'Bearer ' + AUTH_TOKEN, cookie: COOKIE,
    'referer': 'https://platform.deepseek.com/usage', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
    'x-app-version': '1.0.0',
  }

  let balance = 0
  try {
    const balanceRes = await httpsGet('platform.deepseek.com', '/api/v0/users/get_user_summary', dsHeaders)
    if (balanceRes.code === 0 && balanceRes.data?.biz_data?.normal_wallets?.[0]) {
      balance = Number(balanceRes.data.biz_data.normal_wallets[0].balance) || 0
    }
  } catch {}

  const tokenRes = await httpsGet('platform.deepseek.com', '/api/v0/usage/amount?month=' + mo + '&year=' + y, dsHeaders)
  if (tokenRes.code !== 0) throw new Error('Token API 错误: ' + JSON.stringify(tokenRes))

  let data = parseDsTokenData(tokenRes)

  const prevMo = mo === 1 ? 12 : mo - 1, prevY = mo === 1 ? y - 1 : y
  try {
    const prevToken = await httpsGet('platform.deepseek.com', '/api/v0/usage/amount?month=' + prevMo + '&year=' + prevY, dsHeaders)
    if (prevToken.code === 0) data = parseDsTokenData(prevToken).concat(data)
  } catch {}

  const { dailyData, modelData, totalCost } = aggregateDailyAndModel(
    data.filter(r => r.date <= today), monthStr,
    r => calcCost(PRICES, r.model, r.cacheHit, r.cacheMiss, r.output)
  )

  const { sortedDays, chartLabels, chartCosts, chartRequests, modelEntries, modelNames, modelCosts } = buildChartData(dailyData, modelData)

  let _workdays = 0
  for (let _d = 1; _d <= now.getDate(); _d++) {
    const _dow = new Date(now.getFullYear(), now.getMonth(), _d).getDay()
    if (_dow !== 0 && _dow !== 6) _workdays++
  }
  const daysPassed = _workdays || 1
  const dailyAvg = totalCost / daysPassed
  const monthlyEstimate = dailyAvg * 22
  const totalRequests = sortedDays.reduce((sum, d) => sum + d[1].requests, 0)
  const totalHit = sortedDays.reduce((sum, d) => sum + d[1].cacheHit, 0)
  const totalMiss = sortedDays.reduce((sum, d) => sum + d[1].cacheMiss, 0)
  const hitRate = (totalHit + totalMiss) > 0 ? (totalHit / (totalHit + totalMiss) * 100) : 0

  let body = buildSummaryBar(totalCost, dailyAvg, hitRate, monthlyEstimate)
  body += buildStatsGrid([
    { color: 'blue', icon: 'money', label: '账户余额', value: '¥' + parseFloat(balance).toString() },
    { color: 'green', icon: 'money', label: '本月总费用', value: '¥' + totalCost.toFixed(2) },
    { color: 'orange', icon: 'chart', label: '日均费用', value: '¥' + dailyAvg.toFixed(2) },
    { color: 'purple', icon: 'trend', label: '全月预估(22天)', value: '¥' + monthlyEstimate.toFixed(2) },
  ])
  body += buildInsightCards(dailyData, totalCost, totalRequests)
  body += buildChartsSection('deepseek')
  body += buildDayDetailRows(sortedDays, today, yesterday)
  body += buildModelDetailCards(modelEntries)

  const script = buildChartScript(chartLabels, chartCosts, chartRequests, modelNames, modelCosts, totalCost, null, 'deepseek')
  return { content: body, script }
}

// ── 生成错误提示 HTML ──────────────────────────────

function buildErrorContent(error, detail) {
  return `<div class="tab-error">
    <div class="tab-error-icon">⚠️</div>
    <div class="tab-error-title">${esc(error)}</div>
    <div class="tab-error-detail">${esc(detail || '')}</div>
  </div>`
}

// ══════════════════════════════════════════════════════
//  统一报告（Tab 切换，按需加载）
// ══════════════════════════════════════════════════════

async function runUnifiedReport() {
  const cfg = loadConfig()
  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  const yesterday = getDateStr(1)
  const monthStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0')

  // 构建 tab 定义
  const tabDefs = [
    { id: 'mimo-plan', label: 'MiMo 套餐', icon: '📦' },
    { id: 'mimo-payg', label: 'MiMo 按量', icon: '💰' },
    { id: 'deepseek', label: 'DeepSeek', icon: '🤖' },
  ]

  // 按配置顺序重排
  if (cfg.tabOrder) {
    const order = cfg.tabOrder.split(',').map(s => s.trim())
    tabDefs.sort((a, b) => {
      const ai = order.indexOf(a.id)
      const bi = order.indexOf(b.id)
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
    })
  }

  // 加载第一个 Tab 的数据
  const firstId = tabDefs[0].id
  let firstResult
  switch (firstId) {
    case 'mimo-plan':
      firstResult = await buildMimoPlanTab(cfg, now, today, yesterday, monthStr)
        .catch(e => ({ error: 'MiMo 套餐数据获取失败', detail: e.message }))
      break
    case 'mimo-payg':
      firstResult = await buildMimoPaygTab(cfg, now, today, yesterday, monthStr)
        .catch(e => ({ error: 'MiMo 按量数据获取失败', detail: e.message }))
      break
    case 'deepseek':
      firstResult = await buildDeepseekTab(cfg, now, today, yesterday, monthStr)
        .catch(e => ({ error: 'DeepSeek 数据获取失败', detail: e.message }))
      break
  }

  const tabs = tabDefs.map(t => ({
    ...t,
    content: t.id === firstId
      ? (firstResult.error ? buildErrorContent(firstResult.error, firstResult.detail) : firstResult.content)
      : buildLoadingPlaceholder(),
  }))

  const firstTabScript = firstResult.script || ''
  const css = buildReportCss(4)
  const html = wrapUnifiedReport(css, tabs, firstTabScript)

  // 打开窗口，使用 preload 脚本支持 IPC
  const preloadPath = path.join(__dirname, '..', 'src', 'preload-report.js')
  openHtmlReport(html, 'cc_unified_report.html', 'AI 用量报告', {
    webPreferences: { preload: preloadPath }
  })
}

// ── IPC 调用：按需加载 Tab 数据 ─────────────────────

async function loadTabContent(tabId) {
  const cfg = loadConfig()
  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  const yesterday = getDateStr(1)
  const monthStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0')

  try {
    let result
    switch (tabId) {
      case 'mimo-payg':
        result = await buildMimoPaygTab(cfg, now, today, yesterday, monthStr)
        break
      case 'mimo-plan':
        result = await buildMimoPlanTab(cfg, now, today, yesterday, monthStr)
        break
      case 'deepseek':
        result = await buildDeepseekTab(cfg, now, today, yesterday, monthStr)
        break
      default:
        return { error: '未知 Tab', detail: tabId }
    }
    return result.error ? { error: result.error, detail: result.detail } : { content: result.content, script: result.script || '' }
  } catch (e) {
    return { error: '数据获取失败', detail: e.message }
  }
}

// ── API 请求 ─────────────────────────────────────────

function httpsPost(hostname, urlPath, body, headers) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const req = https.request({ hostname, path: urlPath, method: 'POST', timeout: 15000,
      headers: { ...headers, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, (res) => {
      let d = ''
      res.on('data', c => d += c)
      res.on('end', () => {
        try { resolve(JSON.parse(d)) }
        catch { reject(new Error('API 返回非 JSON (HTTP ' + res.statusCode + '):\n' + d.slice(0, 300))) }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')) })
    req.write(payload)
    req.end()
  })
}

function httpsGet(hostname, urlPath, headers) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname, path: urlPath, method: 'GET', timeout: 15000, headers }, (res) => {
      let d = ''
      res.on('data', c => d += c)
      res.on('end', () => {
        try { resolve(JSON.parse(d)) }
        catch { reject(new Error('API 返回非 JSON (HTTP ' + res.statusCode + '):\n' + d.slice(0, 300))) }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')) })
    req.end()
  })
}

// ── 共享数据获取 ─────────────────────────────────────

async function fetchMimoData(COOKIE, ph, commonHeaders, apiPath, y, mo) {
  const res = await httpsPost('platform.xiaomimimo.com', apiPath + '?api-platform_ph=' + encodeURIComponent(ph),
    { year: y, month: mo },
    { ...commonHeaders, Referer: 'https://platform.xiaomimimo.com/console/plan-manage' }
  )
  if (res.code !== 0) {
    throw new Error('API 返回错误 code=' + res.code + '\n' + (res.message || res.msg || JSON.stringify(res).slice(0, 200)))
  }
  return (res.data || []).map(i => ({
    date: i.date, model: i.model, total: i.totalToken || 0,
    cacheHit: i.inputHitToken || 0, cacheMiss: i.inputMissToken || 0,
    output: i.outputToken || 0, requests: i.requestCount || 0,
  }))
}

async function fetchMimoPaygData(COOKIE, ph, commonHeaders, y, mo) {
  const res = await httpsPost('platform.xiaomimimo.com', '/api/v1/usage/detail/list' + '?api-platform_ph=' + encodeURIComponent(ph),
    { year: y, month: mo },
    { ...commonHeaders, Referer: 'https://platform.xiaomimimo.com/console/usage' }
  )
  if (res.code !== 0) {
    throw new Error('API 返回错误 code=' + res.code + '\n' + (res.message || res.msg || JSON.stringify(res).slice(0, 200)))
  }
  return (res.data || []).map(i => ({
    date: i.date, model: i.model, total: i.totalToken || 0,
    cacheHit: i.inputHitToken || 0, cacheMiss: i.inputMissToken || 0,
    output: i.outputToken || 0, requests: i.requestCount || 0,
    cost: parseFloat(i.consumedAmount) || 0,
  }))
}

function getMimoCommonHeaders(COOKIE) {
  return {
    'Accept': '*/*',
    'Accept-Language': 'zh',
    Cookie: COOKIE,
    Origin: 'https://platform.xiaomimimo.com',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
    'x-timezone': 'Asia/Shanghai',
  }
}

async function fetchPrevMonthData(fetcher, ...args) {
  const [,, , , , mo, y] = args
  const prevMo = mo === 1 ? 12 : mo - 1, prevY = mo === 1 ? y - 1 : y
  try {
    return await fetcher(...args.slice(0, -2), prevY, prevMo)
  } catch { return [] }
}

// ── 聚合每日/模型数据 ───────────────────────────────

function aggregateDailyAndModel(data, monthStr, costFn) {
  const dailyData = {}, modelData = {}
  let totalCost = 0
  for (const r of data) {
    const cost = costFn(r)
    if (!dailyData[r.date]) dailyData[r.date] = { cost: 0, requests: 0, total: 0, cacheHit: 0, cacheMiss: 0, output: 0, official: 0 }
    dailyData[r.date].cost += cost; dailyData[r.date].requests += r.requests; dailyData[r.date].total += r.total
    dailyData[r.date].cacheHit += r.cacheHit; dailyData[r.date].cacheMiss += r.cacheMiss; dailyData[r.date].output += r.output
    if (r.date.slice(0, 7) === monthStr) {
      totalCost += cost
      if (!modelData[r.model]) modelData[r.model] = { cacheHit: 0, cacheMiss: 0, output: 0, requests: 0, cost: 0, official: 0 }
      const m = modelData[r.model]
      m.cacheHit += r.cacheHit; m.cacheMiss += r.cacheMiss; m.output += r.output; m.requests += r.requests; m.cost += cost
    }
  }
  return { dailyData, modelData, totalCost }
}

function buildChartData(dailyData, modelData) {
  // 生成最近7天的完整日期范围，缺失的日期补零
  const emptyDay = () => ({ cost: 0, requests: 0, total: 0, cacheHit: 0, cacheMiss: 0, output: 0, official: 0 })
  const today = new Date()
  const allDays = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i)
    const dt = d.toISOString().slice(0, 10)
    allDays.push([dt, dailyData[dt] || emptyDay()])
  }
  const sortedDays = allDays
  const chartLabels = sortedDays.map(d => d[0].slice(5))
  const chartCosts = sortedDays.map(d => +d[1].cost.toFixed(4))
  const chartRequests = sortedDays.map(d => d[1].requests)
  const modelEntries = Object.entries(modelData).sort((a, b) => b[1].cost - a[1].cost)
  const modelNames = modelEntries.map(e => e[0])
  const modelCosts = modelEntries.map(e => e[1].cost.toFixed(4))
  return { sortedDays, chartLabels, chartCosts, chartRequests, modelEntries, modelNames, modelCosts }
}

// ══════════════════════════════════════════════════════
//  MiMo 套餐报告
// ══════════════════════════════════════════════════════

async function runMimoReport() {
  const { dialog } = require('electron')
  const cfg = loadConfig()
  const mimoCfg = cfg.mimo || {}
  const COOKIE = mimoCfg.cookie || ''
  const PRICES = mimoCfg.prices || DEFAULT_PRICES.mimo

  if (!COOKIE.trim()) {
    dialog.showMessageBox({ type: 'warning', title: 'MiMo 用量报告', message: '请先配置 Cookie', detail: '点击"用量报告配置"填入 MiMo Cookie 后重试。', buttons: ['确定'] })
    return
  }

  const now = new Date()
  const y = now.getFullYear(), mo = now.getMonth() + 1
  const today = now.toISOString().slice(0, 10)
  const yesterday = getDateStr(1)
  const monthStr = y + '-' + String(mo).padStart(2, '0')

  try {
    const ph = (COOKIE.match(/api-platform_ph="?([^";]+)"?/) || [])[1] || ''
    const commonHeaders = getMimoCommonHeaders(COOKIE)

    // 获取积分使用情况
    let tokenUsage = { totalLimit: 0, totalUsed: 0, percent: 0 }
    try {
      const usageRes = await httpsGet('platform.xiaomimimo.com', '/api/v1/tokenPlan/usage',
        { ...commonHeaders, Referer: 'https://platform.xiaomimimo.com/console/plan-manage' }
      )
      if (usageRes.code === 0 && usageRes.data?.usage?.items) {
        const items = usageRes.data.usage.items
        tokenUsage.totalLimit = items.reduce((sum, item) => sum + (item.limit || 0), 0)
        tokenUsage.totalUsed = items.reduce((sum, item) => sum + (item.used || 0), 0)
        tokenUsage.percent = tokenUsage.totalLimit > 0 ? (tokenUsage.totalUsed / tokenUsage.totalLimit * 100) : 0
      }
    } catch {}

    const apiPath = '/api/v1/usage/token-plan/list'
    let data = await fetchMimoData(COOKIE, ph, commonHeaders, apiPath, y, mo)
    try {
      const prevData = await fetchMimoData(COOKIE, ph, commonHeaders, apiPath, mo === 1 ? y - 1 : y, mo === 1 ? 12 : mo - 1)
      data = prevData.concat(data)
    } catch {}

    const { dailyData, modelData, totalCost } = aggregateDailyAndModel(data, monthStr, r => calcCost(PRICES, r.model, r.cacheHit, r.cacheMiss, r.output))
    // 深拷贝 dailyData 以添加 official 字段（套餐报告无 official）
    for (const v of Object.values(dailyData)) v.official = 0
    for (const v of Object.values(modelData)) v.official = 0
    const { sortedDays, chartLabels, chartCosts, chartRequests, modelEntries, modelNames, modelCosts } = buildChartData(dailyData, modelData)

    let _workdays = 0
    for (let _d = 1; _d <= now.getDate(); _d++) {
      const _dow = new Date(now.getFullYear(), now.getMonth(), _d).getDay()
      if (_dow !== 0 && _dow !== 6) _workdays++
    }
    const daysPassed = _workdays || 1
    const dailyAvg = totalCost / daysPassed
    const monthlyEstimate = dailyAvg * 22
    const totalRequests = sortedDays.reduce((sum, d) => sum + d[1].requests, 0)
    const totalHit = sortedDays.reduce((sum, d) => sum + d[1].cacheHit, 0)
    const totalMiss = sortedDays.reduce((sum, d) => sum + d[1].cacheMiss, 0)
    const hitRate = (totalHit + totalMiss) > 0 ? (totalHit / (totalHit + totalMiss) * 100) : 0

    // 构建 HTML
    const percentColor = tokenUsage.percent >= 80 ? COLORS.danger : tokenUsage.percent >= 50 ? COLORS.warning : COLORS.success
    let body = buildReportHeader('小米 MiMo 用量报告', now)

    // 顶部摘要条
    body += buildSummaryBar(totalCost, dailyAvg, hitRate, monthlyEstimate)

    // 积分使用情况
    body += '<div class="token-usage">'
    body += `<div class="token-item"><div class="token-label">${icon('token')} 积分总量</div><div class="token-value">${fmtM(tokenUsage.totalLimit)}M</div><div class="token-raw">${tokenUsage.totalLimit.toLocaleString()}</div></div>`
    body += `<div class="token-item"><div class="token-label">${icon('cache')} 已使用</div><div class="token-value">${fmtM(tokenUsage.totalUsed)}M</div><div class="token-raw">${tokenUsage.totalUsed.toLocaleString()}</div></div>`
    body += `<div class="token-item"><div class="token-label">${icon('target')} 使用率</div><div class="stat-value" style="font-size:24px;color:${percentColor}">${tokenUsage.percent.toFixed(1)}%</div></div></div>`

    body += buildStatsGrid([
      { color: 'blue', icon: 'money', label: '本月总费用', value: '¥' + totalCost.toFixed(2) },
      { color: 'green', icon: 'chart', label: '日均费用', value: '¥' + dailyAvg.toFixed(2) },
      { color: 'orange', icon: 'trend', label: '全月预估(22天)', value: '¥' + monthlyEstimate.toFixed(2) },
    ])

    // 洞察指标
    body += buildInsightCards(dailyData, totalCost, totalRequests)

    body += buildChartsSection()
    body += buildDayDetailRows(sortedDays, today, yesterday)
    body += buildModelDetailCards(modelEntries)

    // 建议
    const sortedPlans = (mimoCfg.plans || []).slice().sort((a, b) => a.annual - b.annual)
    const bestPlan = sortedPlans.find(p => monthlyEstimate >= (p.annual / 12) * 0.8)
    body += `<div class="card"><div class="card-title">${icon('bulb')} 智能建议</div>`
    if (bestPlan) {
      body += `<div class="suggest suggest-red">${icon('danger')} 建议购买 ${esc(bestPlan.name)} 套餐 (¥${(bestPlan.annual / 12).toFixed(2)}/月)，可节省费用</div>`
    } else if (sortedPlans.length > 0 && monthlyEstimate >= (sortedPlans[0].annual / 12) * 0.5) {
      body += `<div class="suggest suggest-yellow">${icon('warning')} 接近最低套餐阈值，可考虑购买套餐</div>`
    } else {
      body += `<div class="suggest suggest-green">${icon('success')} 继续按量付费更划算</div>`
    }
    body += '</div>'

    const script = buildChartScript(chartLabels, chartCosts, chartRequests, modelNames, modelCosts, totalCost)
    const html = wrapReport(buildReportCss(3), body, script)
    openHtmlReport(html, 'cc_mimo_report.html', '小米 MiMo 用量报告')
  } catch (e) {
    console.error('[MiMo] Error:', e)
    dialog.showMessageBox({ type: 'error', title: 'MiMo 用量报告', message: '获取数据失败', detail: String(e.stack || e.message || e), buttons: ['确定'] })
  }
}

// ══════════════════════════════════════════════════════
//  MiMo 按量计费报告
// ══════════════════════════════════════════════════════

async function runMimoPaygReport() {
  const { dialog } = require('electron')
  const cfg = loadConfig()
  const mimoCfg = cfg.mimo || {}
  const COOKIE = mimoCfg.cookie || ''

  if (!COOKIE.trim()) {
    dialog.showMessageBox({ type: 'warning', title: 'MiMo 按量计费报告', message: '请先配置 Cookie', detail: '点击"用量报告配置"填入 MiMo Cookie 后重试。', buttons: ['确定'] })
    return
  }

  const now = new Date()
  const y = now.getFullYear(), mo = now.getMonth() + 1
  const today = now.toISOString().slice(0, 10)
  const yesterday = getDateStr(1)
  const monthStr = y + '-' + String(mo).padStart(2, '0')

  try {
    const ph = (COOKIE.match(/api-platform_ph="?([^";]+)"?/) || [])[1] || ''
    const commonHeaders = getMimoCommonHeaders(COOKIE)

    // 获取账户余额
    let balance = 0
    try {
      const balanceRes = await httpsGet('platform.xiaomimimo.com', '/api/v1/balance', commonHeaders)
      if (balanceRes.code === 0) balance = parseFloat(balanceRes.data?.balance) || 0
    } catch {}

    let data = await fetchMimoPaygData(COOKIE, ph, commonHeaders, y, mo)
    try {
      const prevMo = mo === 1 ? 12 : mo - 1, prevY = mo === 1 ? y - 1 : y
      const prevRes = await httpsPost('platform.xiaomimimo.com', '/api/v1/usage/detail/list' + '?api-platform_ph=' + encodeURIComponent(ph),
        { year: prevY, month: prevMo },
        { ...commonHeaders, Referer: 'https://platform.xiaomimimo.com/console/usage' }
      )
      if (prevRes.code === 0) {
        const prevData = (prevRes.data || []).map(i => ({
          date: i.date, model: i.model, total: i.totalToken || 0,
          cacheHit: i.inputHitToken || 0, cacheMiss: i.inputMissToken || 0,
          output: i.outputToken || 0, requests: i.requestCount || 0,
          cost: parseFloat(i.consumedAmount) || 0,
        }))
        data = prevData.concat(data)
      }
    } catch {}

    const { dailyData, modelData, totalCost } = aggregateDailyAndModel(data, monthStr, r => r.cost)
    for (const v of Object.values(dailyData)) v.official = 0
    for (const v of Object.values(modelData)) v.official = 0
    const { sortedDays, chartLabels, chartCosts, chartRequests, modelEntries, modelNames, modelCosts } = buildChartData(dailyData, modelData)

    let _workdays = 0
    for (let _d = 1; _d <= now.getDate(); _d++) {
      const _dow = new Date(now.getFullYear(), now.getMonth(), _d).getDay()
      if (_dow !== 0 && _dow !== 6) _workdays++
    }
    const daysPassed = _workdays || 1
    const dailyAvg = totalCost / daysPassed
    const monthlyEstimate = dailyAvg * 22
    const totalRequests = sortedDays.reduce((sum, d) => sum + d[1].requests, 0)
    const totalHit = sortedDays.reduce((sum, d) => sum + d[1].cacheHit, 0)
    const totalMiss = sortedDays.reduce((sum, d) => sum + d[1].cacheMiss, 0)
    const hitRate = (totalHit + totalMiss) > 0 ? (totalHit / (totalHit + totalMiss) * 100) : 0

    let body = buildReportHeader('小米 MiMo 按量计费报告', now)
    body += buildSummaryBar(totalCost, dailyAvg, hitRate, monthlyEstimate)
    body += buildStatsGrid([
      { color: 'purple', icon: 'money', label: '账户余额', value: '¥' + balance.toFixed(2) },
      { color: 'blue', icon: 'money', label: '本月总费用', value: '¥' + totalCost.toFixed(2) },
      { color: 'green', icon: 'chart', label: '日均费用', value: '¥' + dailyAvg.toFixed(2) },
      { color: 'orange', icon: 'trend', label: '全月预估(22天)', value: '¥' + monthlyEstimate.toFixed(2) },
    ])
    body += buildInsightCards(dailyData, totalCost, totalRequests)
    body += buildChartsSection()
    body += buildDayDetailRows(sortedDays, today, yesterday)
    body += buildModelDetailCards(modelEntries)

    // 建议
    body += `<div class="card"><div class="card-title">${icon('bulb')} 智能建议</div>`
    if (monthlyEstimate >= 34.32) {
      body += `<div class="suggest suggest-red">${icon('danger')} 建议购买 Lite 套餐 (¥34.32/月)，可节省费用</div>`
    } else if (monthlyEstimate >= 20) {
      body += `<div class="suggest suggest-yellow">${icon('warning')} 接近套餐阈值，可考虑购买套餐</div>`
    } else {
      body += `<div class="suggest suggest-green">${icon('success')} 继续按量付费更划算</div>`
    }
    body += '</div>'

    const script = buildChartScript(chartLabels, chartCosts, chartRequests, modelNames, modelCosts, totalCost)
    const html = wrapReport(buildReportCss(4), body, script)
    openHtmlReport(html, 'cc_mimo_payg_report.html', '小米 MiMo 按量计费报告')
  } catch (e) {
    console.error('[MiMo Payg] Error:', e)
    dialog.showMessageBox({ type: 'error', title: 'MiMo 按量计费报告', message: '获取数据失败', detail: String(e.stack || e.message || e), buttons: ['确定'] })
  }
}

// ══════════════════════════════════════════════════════
//  DeepSeek 报告
// ══════════════════════════════════════════════════════

async function runDeepseekReport() {
  const { dialog } = require('electron')
  const cfg = loadConfig()
  const dsCfg = cfg.deepseek || {}
  const AUTH_TOKEN = dsCfg.authToken || ''
  const COOKIE = dsCfg.cookie || ''
  const PRICES = dsCfg.prices || DEFAULT_PRICES.deepseek

  if (!AUTH_TOKEN.trim()) {
    dialog.showMessageBox({ type: 'warning', title: 'DeepSeek 用量报告', message: '请先配置 Auth Token', detail: '点击"用量报告配置"填入 DeepSeek Auth Token 后重试。', buttons: ['确定'] })
    return
  }

  const now = new Date()
  const y = now.getFullYear(), mo = now.getMonth() + 1
  const today = now.toISOString().slice(0, 10)
  const yesterday = getDateStr(1)
  const monthStr = y + '-' + String(mo).padStart(2, '0')

  const dsHeaders = {
    'accept': '*/*', 'authorization': 'Bearer ' + AUTH_TOKEN, cookie: COOKIE,
    'referer': 'https://platform.deepseek.com/usage', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
    'x-app-version': '1.0.0',
  }

  try {
    // 获取账户余额
    let balance = 0
    try {
      const balanceRes = await httpsGet('platform.deepseek.com', '/api/v0/users/get_user_summary', dsHeaders)
      if (balanceRes.code === 0 && balanceRes.data?.biz_data?.normal_wallets?.[0]) {
        balance = Number(balanceRes.data.biz_data.normal_wallets[0].balance) || 0
      }
    } catch {}

    const tokenRes = await httpsGet('platform.deepseek.com', '/api/v0/usage/amount?month=' + mo + '&year=' + y, dsHeaders)
    if (tokenRes.code !== 0) throw new Error('Token API 错误: ' + JSON.stringify(tokenRes))

    let data = parseDsTokenData(tokenRes)

    // 上月
    const prevMo = mo === 1 ? 12 : mo - 1, prevY = mo === 1 ? y - 1 : y
    try {
      const prevToken = await httpsGet('platform.deepseek.com', '/api/v0/usage/amount?month=' + prevMo + '&year=' + prevY, dsHeaders)
      if (prevToken.code === 0) data = parseDsTokenData(prevToken).concat(data)
    } catch {}

    const { dailyData, modelData, totalCost } = aggregateDailyAndModel(
      data.filter(r => r.date <= today), monthStr,
      r => calcCost(PRICES, r.model, r.cacheHit, r.cacheMiss, r.output)
    )

    const { sortedDays, chartLabels, chartCosts, chartRequests, modelEntries, modelNames, modelCosts } = buildChartData(dailyData, modelData)

    let _workdays = 0
    for (let _d = 1; _d <= now.getDate(); _d++) {
      const _dow = new Date(now.getFullYear(), now.getMonth(), _d).getDay()
      if (_dow !== 0 && _dow !== 6) _workdays++
    }
    const daysPassed = _workdays || 1
    const dailyAvg = totalCost / daysPassed
    const monthlyEstimate = dailyAvg * 22
    const totalRequests = sortedDays.reduce((sum, d) => sum + d[1].requests, 0)
    const totalHit = sortedDays.reduce((sum, d) => sum + d[1].cacheHit, 0)
    const totalMiss = sortedDays.reduce((sum, d) => sum + d[1].cacheMiss, 0)
    const hitRate = (totalHit + totalMiss) > 0 ? (totalHit / (totalHit + totalMiss) * 100) : 0

    let body = buildReportHeader('DeepSeek 用量报告', now)
    body += buildSummaryBar(totalCost, dailyAvg, hitRate, monthlyEstimate)
    body += buildStatsGrid([
      { color: 'blue', icon: 'money', label: '账户余额', value: '¥' + parseFloat(balance).toString() },
      { color: 'green', icon: 'money', label: '本月总费用', value: '¥' + totalCost.toFixed(2) },
      { color: 'orange', icon: 'chart', label: '日均费用', value: '¥' + dailyAvg.toFixed(2) },
      { color: 'purple', icon: 'trend', label: '全月预估(22天)', value: '¥' + monthlyEstimate.toFixed(2) },
    ])
    body += buildInsightCards(dailyData, totalCost, totalRequests)
    body += buildChartsSection()
    body += buildDayDetailRows(sortedDays, today, yesterday)
    body += buildModelDetailCards(modelEntries)

    const script = buildChartScript(chartLabels, chartCosts, chartRequests, modelNames, modelCosts, totalCost)
    const html = wrapReport(buildReportCss(4), body, script)
    openHtmlReport(html, 'cc_deepseek_report.html', 'DeepSeek 用量报告')
  } catch (e) {
    console.error('[DeepSeek] Error:', e)
    dialog.showMessageBox({ type: 'error', title: 'DeepSeek 用量报告', message: '获取数据失败', detail: String(e.stack || e.message || e), buttons: ['确定'] })
  }
}

function parseDsTokenData(apiRes) {
  const days = apiRes.data.biz_data.days || []
  const result = []
  for (const day of days) {
    for (const m of day.data || []) {
      const usage = m.usage || []
      let cacheHit = 0, cacheMiss = 0, output = 0, requests = 0
      for (const u of usage) {
        const amt = parseInt(u.amount) || 0
        if (u.type === 'PROMPT_CACHE_HIT_TOKEN') cacheHit = amt
        else if (u.type === 'PROMPT_CACHE_MISS_TOKEN') cacheMiss = amt
        else if (u.type === 'RESPONSE_TOKEN') output = amt
        else if (u.type === 'REQUEST') requests = amt
      }
      result.push({ date: day.date, model: m.model, total: cacheHit + cacheMiss + output, cacheHit, cacheMiss, output, requests })
    }
  }
  return result.filter(r => r.model !== 'deepseek-chat & deepseek-reasoner')
}

function parseDsAmountData(apiRes) {
  const bizData = apiRes.data.biz_data
  const days = Array.isArray(bizData) ? (bizData[0].days || []) : (bizData.days || [])
  const result = []
  for (const day of days) {
    for (const m of day.data || []) {
      const usage = m.usage || []
      let total = 0
      for (const u of usage) total += parseFloat(u.amount) || 0
      result.push({ date: day.date, model: m.model, total })
    }
  }
  return result.filter(r => r.model !== 'deepseek-chat & deepseek-reasoner')
}

module.exports = { runMimoReport, runMimoPaygReport, runDeepseekReport, runUnifiedReport, loadTabContent, openBillingConfig, updateBillingConfig, parseBillingFile }
