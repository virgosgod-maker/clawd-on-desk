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
  'mimo_username=',
  'mimo_password=',
  '',
  '# ── DeepSeek ──',
  'deepseek_auth_token=',
  'deepseek_cookie=',
  'deepseek_username=',
  'deepseek_password=',
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
      + '  mimo_username=MiMo账号（用于自动填充登录）\n'
      + '  mimo_password=MiMo密码（用于自动填充登录）\n'
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

const COLORS = {
  textPrimary: '#202124', textSecondary: '#5f6368',
  primary: '#1a73e8', success: '#34a853', warning: '#fbbc04', danger: '#ea4335',
  bgLight: '#f8f9fa',
  gradientBlue: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
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
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:"Microsoft YaHei","Segoe UI",sans-serif;background:linear-gradient(135deg,#f5f7fa 0%,#c3cfe2 100%);min-height:100vh;padding:20px;color:${C.textPrimary}}
.container{max-width:900px;margin:0 auto}
.header{background:${C.gradientBlue};border-radius:16px;padding:24px 28px;margin-bottom:20px;color:#fff;box-shadow:0 4px 15px rgba(102,126,234,.4)}
.header-title{font-size:24px;font-weight:bold;display:flex;align-items:center;gap:10px}
.header-date{font-size:13px;opacity:.9;margin-top:6px}
.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 2px 10px rgba(0,0,0,.08)}
.card-title{font-size:16px;font-weight:bold;color:${C.textPrimary};margin-bottom:14px;display:flex;align-items:center;gap:8px}
.stats-grid{display:grid;grid-template-columns:repeat(${statsCols},1fr);gap:12px;margin-bottom:16px}
.stat-card{padding:16px;border-radius:10px;text-align:center}
.stat-card.blue{background:linear-gradient(135deg,#667eea20,#764ba220);border:1px solid #667eea40}
.stat-card.green{background:linear-gradient(135deg,#43e97b20,#38f9d720);border:1px solid #43e97b40}
.stat-card.orange{background:linear-gradient(135deg,#fa709a20,#fee14020);border:1px solid #fa709a40}
.stat-card.purple{background:linear-gradient(135deg,#a18cd120,#fbc2eb20);border:1px solid #a18cd140}
.stat-label{font-size:12px;color:${C.textSecondary};margin-bottom:4px}
.stat-value{font-size:22px;font-weight:bold;font-family:Consolas,monospace}
.stat-card.blue .stat-value{color:#667eea}
.stat-card.green .stat-value{color:#34a853}
.stat-card.orange .stat-value{color:#ff9800}
.stat-card.purple .stat-value{color:#9c27b0}
.charts-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}
.chart-container{position:relative;height:250px}
.model-card{background:#fff;border-radius:10px;padding:14px;margin-bottom:10px;border-left:4px solid ${C.primary}}
.model-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
.model-name{font-weight:bold;color:${C.primary};font-size:14px;display:flex;align-items:center;gap:6px}
.model-cost{font-weight:bold;color:${C.danger};font-family:Consolas,monospace}
.model-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.model-stat{text-align:center;padding:8px 4px;background:${C.bgLight};border-radius:6px}
.model-stat-label{font-size:11px;color:${C.textSecondary};display:flex;align-items:center;justify-content:center;gap:3px}
.model-stat-value{font-size:13px;font-weight:bold;font-family:Consolas,monospace;margin-top:2px}
.day-header{display:grid;grid-template-columns:140px repeat(7,1fr);gap:4px;padding:8px 12px;font-size:11px;color:${C.textSecondary};font-weight:bold;border-bottom:2px solid #e0e0e0;margin-bottom:6px}
.day-h-date{text-align:left}.day-h-stat{text-align:center}
.day-row-detail{display:grid;grid-template-columns:140px repeat(7,1fr);gap:4px;padding:8px 12px;border-radius:8px;margin-bottom:4px;background:${C.bgLight};align-items:center;font-size:12px}
.day-stat-cell{text-align:center;color:${C.textSecondary};font-family:Consolas,monospace}
.day-cost{font-weight:bold;color:${C.danger}}
.day-official{font-weight:bold;color:${C.success}}
.suggest{padding:14px 18px;border-radius:10px;display:flex;align-items:center;gap:10px}
.suggest-green{background:linear-gradient(135deg,#e6f4ea,#ceead6);border:1px solid #a8dab5;color:#137333}
.suggest-yellow{background:linear-gradient(135deg,#fef7e0,#feefc3);border:1px solid #fdd663;color:#7c6300}
.suggest-red{background:linear-gradient(135deg,#fce8e6,#f8d7da);border:1px solid #f5b7b1;color:#a50e0e}
.token-usage{background:linear-gradient(135deg,#667eea15,#764ba215);border:1px solid #667eea30;border-radius:10px;padding:16px;margin-bottom:16px;display:flex;justify-content:space-around;align-items:center}
.token-item{text-align:center}.token-label{font-size:12px;color:${C.textSecondary};margin-bottom:4px}
.token-value{font-size:18px;font-weight:bold;font-family:Consolas,monospace;color:#667eea}
.token-raw{font-size:11px;color:${C.textSecondary};font-family:Consolas,monospace;margin-top:2px}
.icon{display:inline-flex;vertical-align:middle}.icon svg{display:block}
`
}

function buildReportHeader(title, now) {
  return `<div class="header"><div class="header-title">${icon('rocket')} ${esc(title)}</div><div class="header-date">${icon('calendar')} ${now.toLocaleString()}</div></div>`
}

function buildStatsGrid(cards) {
  let h = '<div class="stats-grid">'
  for (const c of cards) {
    h += `<div class="stat-card ${c.color}"><div class="stat-label">${icon(c.icon)} ${esc(c.label)}</div><div class="stat-value">${c.value}</div></div>`
  }
  return h + '</div>'
}

function buildChartsSection() {
  return `<div class="charts-grid">
<div class="card"><div class="card-title">${icon('chart')} 每日费用趋势</div><div class="chart-container"><canvas id="lineChart"></canvas></div></div>
<div class="card"><div class="card-title">${icon('pie')} 模型费用占比</div><div class="chart-container"><canvas id="pieChart"></canvas></div></div></div>`
}

function buildDayDetailRows(sortedDays, today, yesterday, opts = {}) {
  const wk = ['日', '一', '二', '三', '四', '五', '六']
  const showOfficial = !!opts.showOfficial
  const colCount = showOfficial ? 9 : 8

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

  for (const [dt, inf] of sortedDays.slice().reverse()) {
    const isToday = dt === today, isYesterday = dt === yesterday
    const dayLabel = isToday ? '今天' : isYesterday ? '昨天' : '周' + wk[new Date(dt).getDay()]
    const dayTotal = inf.cacheHit + inf.cacheMiss + inf.output
    const rate = dayTotal > 0 ? ((inf.cacheHit / dayTotal) * 100) : 0
    h += `<div class="day-row-detail"><div class="day-date">${icon('calendar')} ${dt.slice(5)} (${dayLabel})</div>`
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
  const modelColors = ['#4285f4', '#34a853', '#fbbc04', '#ea4335', '#9c27b0', '#009688', '#ff9800', '#e91e63']
  const showOfficial = !!opts.showOfficial

  let h = `<div class="card"><div class="card-title">${icon('robot')} 各模型本月汇总</div>`
  for (let i = 0; i < modelEntries.length; i++) {
    const [modelName, s] = modelEntries[i]
    const totalTokens = s.cacheHit + s.cacheMiss + s.output
    const rate = totalTokens > 0 ? ((s.cacheHit / totalTokens) * 100) : 0
    h += `<div class="model-card" style="border-left-color:${modelColors[i % modelColors.length]}">`
    h += `<div class="model-header"><div class="model-name">${icon('robot')} ${esc(modelName)}</div>`
    h += `<div>`
    if (showOfficial) h += `<span class="model-cost" style="color:${COLORS.success};margin-right:8px">¥${s.official.toFixed(4)}</span>`
    h += `<span class="model-cost">¥${s.cost.toFixed(4)}</span></div></div>`
    h += '<div class="model-stats">'
    h += `<div class="model-stat"><div class="model-stat-label">${icon('cache')} 命中缓存</div><div class="model-stat-value">${fmtM(s.cacheHit)}M</div></div>`
    h += `<div class="model-stat"><div class="model-stat-label">${icon('miss')} 未命中</div><div class="model-stat-value">${fmtM(s.cacheMiss)}M</div></div>`
    h += `<div class="model-stat"><div class="model-stat-label">${icon('output')} 输出</div><div class="model-stat-value">${fmtM(s.output)}M</div></div>`
    h += `<div class="model-stat"><div class="model-stat-label">${icon('request')} 请求</div><div class="model-stat-value">${s.requests} 次</div></div></div>`
    h += `<div style="margin-top:8px;font-size:12px;color:${COLORS.textSecondary};display:flex;align-items:center;gap:4px">${icon('target')} 缓存命中率: <strong style="color:${hitRateColor(rate)}">${rate.toFixed(1)}%</strong></div></div>`
  }
  return h + '</div>'
}

function buildChartScript(chartLabels, chartCosts, chartRequests, modelNames, modelCosts, totalCost, extraDatasets) {
  const modelColors = ['#4285f4', '#34a853', '#fbbc04', '#ea4335', '#9c27b0', '#009688', '#ff9800', '#e91e63']
  const lineDatasets = [
    `{label:"每日费用 (¥)",data:${JSON.stringify(chartCosts)},borderColor:"#667eea",backgroundColor:"rgba(102,126,234,.1)",borderWidth:3,fill:true,tension:.4,pointBackgroundColor:"#667eea",pointBorderColor:"#fff",pointBorderWidth:2,pointRadius:5}`,
  ]
  if (chartRequests) {
    lineDatasets.push(`{label:"请求次数",data:${JSON.stringify(chartRequests)},borderColor:"#34a853",backgroundColor:"rgba(52,168,83,.1)",borderWidth:2,fill:false,tension:.4,pointBackgroundColor:"#34a853",pointBorderColor:"#fff",pointBorderWidth:2,pointRadius:4,yAxisID:"y1"}`)
  }
  if (extraDatasets) {
    lineDatasets.push(...extraDatasets)
  }

  const yScales = chartRequests
    ? `y:{beginAtZero:true,title:{display:true,text:"费用 (¥)"}},y1:{position:"right",beginAtZero:true,title:{display:true,text:"请求次数"},grid:{drawOnChartArea:false}}`
    : `y:{beginAtZero:true,title:{display:true,text:"费用 (¥)"}}`

  let s = '<script>document.addEventListener("DOMContentLoaded",function(){'
  s += `new Chart(document.getElementById("lineChart"),{type:"line",data:{labels:${JSON.stringify(chartLabels)},datasets:[${lineDatasets.join(',')}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:"top",labels:{usePointStyle:true,padding:15}}},scales:{${yScales}}}});`
  s += `new Chart(document.getElementById("pieChart"),{type:"doughnut",data:{labels:${JSON.stringify(modelNames)},datasets:[{data:${JSON.stringify(modelCosts)},backgroundColor:${JSON.stringify(modelColors.slice(0, modelNames.length))},borderWidth:3,borderColor:"#fff",hoverOffset:10}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:"bottom",labels:{usePointStyle:true,padding:12,font:{size:11}}},tooltip:{callbacks:{label:function(ctx){return ctx.label+": ¥"+ctx.parsed+" ("+((ctx.parsed/${totalCost})*100).toFixed(1)+"%)"}}}}}});`
  s += '});</script>'
  return s
}

function wrapReport(css, bodyHtml, scriptHtml) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">`
    + `<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>`
    + `<style>${css}</style></head><body><div class="container">`
    + bodyHtml
    + `</div>${scriptHtml}</body></html>`
}

// ── 弹窗展示 HTML 报告 ──────────────────────────────

function openHtmlReport(html, filename, title) {
  const { BrowserWindow, app } = require('electron')
  const filePath = path.join(os.tmpdir(), filename)
  fs.writeFileSync(filePath, html, 'utf-8')

  // 获取图标路径，保持与项目其他窗口一致
  let iconPath
  try {
    const isPackaged = app.isPackaged
    const resourcesPath = process.resourcesPath
    const appDir = path.join(__dirname, '..')
    if (process.platform === 'win32') {
      if (isPackaged) {
        iconPath = [
          path.join(resourcesPath, 'app.asar.unpacked', 'assets', 'icons', '256x256.png'),
          path.join(resourcesPath, 'app.asar', 'assets', 'icons', '256x256.png'),
          path.join(resourcesPath, 'icon.ico'),
        ].find(p => { try { return fs.existsSync(p) } catch { return false } })
      } else {
        iconPath = [
          path.join(appDir, 'assets', 'icons', '256x256.png'),
          path.join(appDir, 'assets', 'icon.ico'),
        ].find(p => { try { return fs.existsSync(p) } catch { return false } })
      }
    }
  } catch {}

  const opts = {
    width: 940,
    height: 720,
    title: title || '用量报告',
    autoHideMenuBar: true,
    minimizable: true,
    maximizable: true,
    resizable: true,
    webPreferences: { contextIsolation: true, sandbox: true },
  }
  if (iconPath) opts.icon = iconPath

  const win = new BrowserWindow(opts)
  win.loadFile(filePath)
  win.on('closed', () => {
    try { fs.unlinkSync(filePath) } catch {}
  })
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

    const daysPassed = now.getDate() || 1
    const dailyAvg = totalCost / daysPassed
    const monthlyEstimate = dailyAvg * 22

    // 构建 HTML
    const percentColor = tokenUsage.percent >= 80 ? COLORS.danger : tokenUsage.percent >= 50 ? COLORS.warning : COLORS.success
    let body = buildReportHeader('小米 MiMo 用量报告', now)

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

    const daysPassed = now.getDate() || 1
    const dailyAvg = totalCost / daysPassed
    const monthlyEstimate = dailyAvg * 22

    let body = buildReportHeader('小米 MiMo 按量计费报告', now)
    body += buildStatsGrid([
      { color: 'purple', icon: 'money', label: '账户余额', value: '¥' + balance.toFixed(2) },
      { color: 'blue', icon: 'money', label: '本月总费用', value: '¥' + totalCost.toFixed(2) },
      { color: 'green', icon: 'chart', label: '日均费用', value: '¥' + dailyAvg.toFixed(2) },
      { color: 'orange', icon: 'trend', label: '全月预估(22天)', value: '¥' + monthlyEstimate.toFixed(2) },
    ])
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

    let amountRes
    try {
      amountRes = await httpsGet('platform.deepseek.com', '/api/v0/usage/cost?month=' + mo + '&year=' + y, dsHeaders)
    } catch {}

    let data = parseDsTokenData(tokenRes)
    let amountData = amountRes && amountRes.code === 0 ? parseDsAmountData(amountRes) : []

    // 上月
    const prevMo = mo === 1 ? 12 : mo - 1, prevY = mo === 1 ? y - 1 : y
    try {
      const prevToken = await httpsGet('platform.deepseek.com', '/api/v0/usage/amount?month=' + prevMo + '&year=' + prevY, dsHeaders)
      if (prevToken.code === 0) data = parseDsTokenData(prevToken).concat(data)
    } catch {}
    try {
      const prevAmount = await httpsGet('platform.deepseek.com', '/api/v0/usage/cost?month=' + prevMo + '&year=' + prevY, dsHeaders)
      if (prevAmount.code === 0) amountData = parseDsAmountData(prevAmount).concat(amountData)
    } catch {}

    const { dailyData, modelData, totalCost } = aggregateDailyAndModel(
      data.filter(r => r.date <= today), monthStr,
      r => calcCost(PRICES, r.model, r.cacheHit, r.cacheMiss, r.output)
    )

    // 合并官方计费数据
    let totalOfficial = 0
    for (const r of amountData) {
      if (r.date > today) continue
      if (!dailyData[r.date]) dailyData[r.date] = { cost: 0, requests: 0, total: 0, official: 0, cacheHit: 0, cacheMiss: 0, output: 0 }
      dailyData[r.date].official += r.total
      if (r.date.slice(0, 7) === monthStr) {
        totalOfficial += r.total
        if (!modelData[r.model]) modelData[r.model] = { cacheHit: 0, cacheMiss: 0, output: 0, requests: 0, cost: 0, official: 0 }
        modelData[r.model].official += r.total
      }
    }

    const { sortedDays, chartLabels, chartCosts, chartRequests, modelEntries, modelNames, modelCosts } = buildChartData(dailyData, modelData)
    const chartOfficial = sortedDays.map(d => +d[1].official.toFixed(4))

    const daysPassed = now.getDate() || 1
    const dailyAvg = totalCost / daysPassed
    const monthlyEstimate = dailyAvg * 22

    let body = buildReportHeader('DeepSeek 用量报告', now)
    body += buildStatsGrid([
      { color: 'blue', icon: 'money', label: '账户余额', value: '¥' + parseFloat(balance).toString() },
      { color: 'green', icon: 'money', label: '本月总费用', value: '¥' + totalCost.toFixed(2) },
      { color: 'orange', icon: 'chart', label: '日均费用', value: '¥' + dailyAvg.toFixed(2) },
      { color: 'purple', icon: 'trend', label: '全月预估(22天)', value: '¥' + monthlyEstimate.toFixed(2) },
    ])
    body += buildChartsSection()
    body += buildDayDetailRows(sortedDays, today, yesterday, { showOfficial: true })
    body += buildModelDetailCards(modelEntries, { showOfficial: true })

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

module.exports = { runMimoReport, runMimoPaygReport, runDeepseekReport, openBillingConfig, updateBillingConfig, parseBillingFile }
