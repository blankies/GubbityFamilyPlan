import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  applyPayment,
  dollarsToCents,
  formatMoney,
  isIsoDate,
  statusFor,
  todayISO,
} from './coverage.js'
import { renderError, renderLogin, renderMember, renderMissing, renderOwner } from './pages.js'
import { createStore } from './store.js'

loadEnv(path.join(process.cwd(), '.env'))

const config = readConfig()
const store = createStore(path.join(process.cwd(), 'data', 'plan.json'))
const cssPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'styles.css')

const server = http.createServer((req, res) => {
  handle(req, res).catch((error) => {
    console.error(error)
    const status = error.status === 413 ? 413 : 500
    sendHtml(res, status, renderError())
  })
})

server.listen(config.port, () => {
  console.log(`Family plan coverage is running at http://localhost:${config.port}`)
})

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
  let pathName
  try {
    pathName = decodeURIComponent(url.pathname)
  } catch {
    sendHtml(res, 404, renderMissing())
    return
  }

  if (req.method === 'GET' && pathName === '/styles.css') {
    res.writeHead(200, {
      'Content-Type': 'text/css; charset=utf-8',
      'Cache-Control': 'no-cache',
    })
    res.end(fs.readFileSync(cssPath))
    return
  }

  if (req.method === 'GET' && pathName === '/favicon.ico') {
    res.writeHead(204)
    res.end()
    return
  }

  const memberMatch = pathName.match(/^\/m\/([A-Za-z0-9_-]+)$/)
  if (req.method === 'GET' && memberMatch) {
    const member = store.read().members.find((item) => item.token === memberMatch[1])
    if (!member) {
      sendHtml(res, 404, renderMissing())
      return
    }
    sendHtml(res, 200, renderMember(member, { today: todayISO(config.timeZone) }))
    return
  }

  if (req.method === 'POST' && pathName === '/login') {
    const form = await readForm(req)
    if (!passwordOk(form.get('password') ?? '', config.ownerPassword)) {
      sendHtml(res, 401, renderLogin({ error: 'That password does not match.' }))
      return
    }
    redirect(res, '/', [sessionCookie()])
    return
  }

  if (req.method === 'GET' && pathName === '/') {
    if (!isOwner(req)) {
      sendHtml(res, 200, renderLogin())
      return
    }
    const cookies = []
    const flash = takeFlash(req, cookies)
    sendHtml(res, 200, renderOwner({
      plan: store.read(),
      today: todayISO(config.timeZone),
      origin: originOf(req),
      timeZone: config.timeZone,
      flash,
    }), cookies)
    return
  }

  if (!isOwner(req)) {
    redirect(res, '/')
    return
  }

  if (req.method === 'POST' && pathName === '/logout') {
    redirect(res, '/', [cookie('plan_session', '', { clear: true })])
    return
  }

  if (req.method !== 'POST') {
    sendHtml(res, 404, renderMissing())
    return
  }

  const form = await readForm(req)

  if (pathName === '/rate') {
    const cents = dollarsToCents(form.get('amount'))
    if (!cents) {
      flashRedirect(res, 'Enter a monthly price greater than zero, up to $100,000.')
      return
    }
    await store.update((data) => {
      data.monthlyRateCents = cents
    })
    flashRedirect(res, `Monthly price is now ${formatMoney(cents)}.`)
    return
  }

  if (pathName === '/members') {
    const name = cleanName(form.get('name'))
    if (!name) {
      flashRedirect(res, 'Enter a name up to 80 characters.')
      return
    }
    await store.update((data) => {
      data.members.push({
        id: newId(),
        name,
        token: newToken(data.members),
        coveredUntil: null,
        creditCents: 0,
        history: [],
      })
    })
    flashRedirect(res, `Added ${name}. Their private link is on their card.`)
    return
  }

  const action = pathName.match(/^\/members\/([A-Za-z0-9_-]+)\/(pay|coverage|undo|relink)$/)
  if (!action) {
    sendHtml(res, 404, renderMissing())
    return
  }

  const result = await store.update((data) => mutateMember(data, action[1], action[2], form, todayISO(config.timeZone)))
  flashRedirect(res, result.error || result.message)
}

function mutateMember(data, id, kind, form, today) {
  const member = data.members.find((item) => item.id === id)
  if (!member) return { error: 'That person is not on the plan.' }

  if (kind === 'pay') {
    if (!data.monthlyRateCents) return { error: 'Set the monthly price first.' }
    const amountCents = dollarsToCents(form.get('amount'))
    if (!amountCents) return { error: 'Enter a payment greater than zero, up to $100,000.' }
    const paidOn = String(form.get('date') || '')
    if (!isIsoDate(paidOn)) return { error: 'Enter a valid payment date.' }
    let applied
    try {
      applied = applyPayment({
        coveredUntil: member.coveredUntil,
        creditCents: member.creditCents,
        amountCents,
        paidOn,
        rateCents: data.monthlyRateCents,
      })
    } catch (error) {
      return { error: error.message }
    }
    const before = snapshot(member)
    member.coveredUntil = applied.coveredUntil
    member.creditCents = applied.creditCents
    pushHistory(member, {
      id: newId(),
      type: 'payment',
      at: new Date().toISOString(),
      before,
      amountCents,
      paidOn,
    })
    const status = statusFor({
      coveredUntil: member.coveredUntil,
      creditCents: member.creditCents,
      today,
    })
    const recorded = `Recorded ${formatMoney(amountCents)} for ${member.name}.`
    if (!applied.extended) return { message: `${recorded} ${status.creditText}` }
    return { message: `${recorded} ${status.summary}${status.creditText ? ` ${status.creditText}` : ''}` }
  }

  if (kind === 'coverage') {
    const until = String(form.get('until') || '')
    if (!isIsoDate(until)) return { error: 'Enter the date they are paid through.' }
    const before = snapshot(member)
    member.coveredUntil = until
    pushHistory(member, {
      id: newId(),
      type: 'coverage',
      at: new Date().toISOString(),
      before,
      until,
    })
    const status = statusFor({
      coveredUntil: member.coveredUntil,
      creditCents: member.creditCents,
      today,
    })
    return { message: `${member.name}: ${status.summary}` }
  }

  if (kind === 'undo') {
    const last = member.history.at(-1)
    if (!last?.before) return { error: `Nothing to undo for ${member.name}.` }
    member.coveredUntil = last.before.coveredUntil ?? null
    member.creditCents = Number.isInteger(last.before.creditCents) ? last.before.creditCents : 0
    if (last.before.token) member.token = last.before.token
    member.history.pop()
    return { message: `Undid the last change for ${member.name}.` }
  }

  if (kind === 'relink') {
    const before = snapshot(member)
    member.token = newToken(data.members)
    pushHistory(member, {
      id: newId(),
      type: 'relink',
      at: new Date().toISOString(),
      before,
    })
    return { message: `New link ready for ${member.name}. The old link no longer works.` }
  }

  return { error: 'That action is not available.' }
}

function snapshot(member) {
  return {
    coveredUntil: member.coveredUntil,
    creditCents: member.creditCents,
    token: member.token,
  }
}

function pushHistory(member, entry) {
  member.history.push(entry)
  if (member.history.length > 30) member.history.splice(0, member.history.length - 30)
}

function cleanName(value) {
  const name = String(value ?? '').replace(/\s+/g, ' ').trim()
  if (!name || name.length > 80) return null
  return name
}

function newId() {
  return crypto.randomBytes(9).toString('base64url')
}

function newToken(members) {
  const used = new Set(members.map((member) => member.token))
  let token
  do {
    token = crypto.randomBytes(18).toString('base64url')
  } while (used.has(token))
  return token
}

function isOwner(req) {
  const raw = readCookies(req).plan_session
  if (!raw) return false
  const dot = raw.lastIndexOf('.')
  if (dot <= 0) return false
  const payload = raw.slice(0, dot)
  const signature = raw.slice(dot + 1)
  const expected = crypto.createHmac('sha256', config.sessionSecret).update(payload).digest('base64url')
  const given = Buffer.from(signature)
  const wanted = Buffer.from(expected)
  if (given.length !== wanted.length || !crypto.timingSafeEqual(given, wanted)) return false
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    return typeof data.exp === 'number' && data.exp > Date.now()
  } catch {
    return false
  }
}

function passwordOk(input, expected) {
  const given = crypto.createHash('sha256').update(String(input), 'utf8').digest()
  const wanted = crypto.createHash('sha256').update(String(expected), 'utf8').digest()
  return crypto.timingSafeEqual(given, wanted)
}

function sessionCookie() {
  const payload = Buffer.from(JSON.stringify({
    exp: Date.now() + 30 * 24 * 60 * 60 * 1000,
  })).toString('base64url')
  const signature = crypto.createHmac('sha256', config.sessionSecret).update(payload).digest('base64url')
  return cookie('plan_session', `${payload}.${signature}`, { maxAge: 30 * 24 * 60 * 60 })
}

function flashCookie(message) {
  const value = Buffer.from(String(message).slice(0, 500), 'utf8').toString('base64url')
  return cookie('plan_flash', value, { maxAge: 120 })
}

function takeFlash(req, jar) {
  const raw = readCookies(req).plan_flash
  if (!raw) return ''
  jar.push(cookie('plan_flash', '', { clear: true }))
  try {
    return Buffer.from(raw, 'base64url').toString('utf8')
  } catch {
    return ''
  }
}

function readCookies(req) {
  const out = {}
  const header = req.headers.cookie
  if (!header) return out
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index === -1) continue
    out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim())
  }
  return out
}

function cookie(name, value, { maxAge, clear } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax']
  if (clear) parts.push('Max-Age=0')
  else if (maxAge) parts.push(`Max-Age=${maxAge}`)
  return parts.join('; ')
}

function originOf(req) {
  const host = req.headers.host || `localhost:${config.port}`
  const forwarded = req.headers['x-forwarded-proto']
  const proto = forwarded === 'https' ? 'https' : 'http'
  return `${proto}://${host}`
}

function readForm(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 100_000) {
        reject(Object.assign(new Error('Form is too large.'), { status: 413 }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      resolve(new URLSearchParams(Buffer.concat(chunks).toString('utf8')))
    })
    req.on('error', reject)
  })
}

function flashRedirect(res, message) {
  redirect(res, '/', [flashCookie(message)])
}

function redirect(res, location, cookies = []) {
  const headers = { Location: location, 'Cache-Control': 'no-store' }
  if (cookies.length) headers['Set-Cookie'] = cookies
  res.writeHead(303, headers)
  res.end()
}

function sendHtml(res, status, body, cookies = []) {
  const headers = {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
  }
  if (cookies.length) headers['Set-Cookie'] = cookies
  res.writeHead(status, headers)
  res.end(body)
}

function loadEnv(file) {
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return
    throw error
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    process.env[key] = value
  }
}

function readConfig() {
  const ownerPassword = process.env.OWNER_PASSWORD || ''
  const sessionSecret = process.env.SESSION_SECRET || ''
  const timeZone = process.env.TIMEZONE || 'America/Denver'
  const port = Number(process.env.PORT || 3000)
  if (!ownerPassword) {
    console.error('Set OWNER_PASSWORD in .env before starting.')
    process.exit(1)
  }
  if (sessionSecret.length < 16) {
    console.error('Set SESSION_SECRET in .env to at least 16 characters.')
    process.exit(1)
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('PORT must be a number from 1 to 65535.')
    process.exit(1)
  }
  try {
    todayISO(timeZone)
  } catch {
    console.error(`TIMEZONE is not valid: ${timeZone}`)
    process.exit(1)
  }
  return { ownerPassword, sessionSecret, timeZone, port }
}
