const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function isIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  if (month < 1 || month > 12 || day < 1) return false
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

export function todayISO(timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const value = (type) => parts.find((part) => part.type === type)?.value
  const year = value('year')
  const month = value('month')
  const day = value('day')
  if (!year || !month || !day) throw new Error(`Could not read today's date in ${timeZone}.`)
  return `${year}-${month}-${day}`
}

export function formatDate(iso) {
  if (!isIsoDate(iso)) throw new Error('Invalid date.')
  const [year, month, day] = iso.split('-').map(Number)
  return `${MONTHS[month - 1]} ${day}, ${year}`
}

export function formatMoney(cents) {
  const amount = Number(cents)
  if (!Number.isInteger(amount)) throw new Error('Money must be whole cents.')
  const sign = amount < 0 ? '-' : ''
  const abs = Math.abs(amount)
  return `${sign}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

export function centsToInput(cents) {
  const amount = Number(cents)
  if (!Number.isInteger(amount) || amount < 0) return ''
  return `${Math.floor(amount / 100)}.${String(amount % 100).padStart(2, '0')}`
}

export function dollarsToCents(input) {
  const text = String(input ?? '').trim()
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null
  const [whole, fraction = ''] = text.split('.')
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 10_000_000) return null
  return cents
}

export function addDays(iso, days) {
  if (!isIsoDate(iso) || !Number.isInteger(days)) throw new Error('Invalid day offset.')
  const [year, month, day] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return isoFromUTC(date)
}

export function addMonths(iso, months) {
  if (!isIsoDate(iso) || !Number.isInteger(months)) throw new Error('Invalid month offset.')
  const [year, month, day] = iso.split('-').map(Number)
  const index = month - 1 + months
  const targetYear = year + Math.floor(index / 12)
  const targetMonth = ((index % 12) + 12) % 12
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate()
  return isoFromUTC(new Date(Date.UTC(targetYear, targetMonth, Math.min(day, lastDay))))
}

export function diffDays(start, end) {
  if (!isIsoDate(start) || !isIsoDate(end)) throw new Error('Invalid date span.')
  const [startYear, startMonth, startDay] = start.split('-').map(Number)
  const [endYear, endMonth, endDay] = end.split('-').map(Number)
  const ms = Date.UTC(endYear, endMonth - 1, endDay) - Date.UTC(startYear, startMonth - 1, startDay)
  return Math.round(ms / 86_400_000)
}

export function nextDueDate(coveredUntil) {
  if (!coveredUntil) return null
  return addDays(coveredUntil, 1)
}

export function applyPayment({ coveredUntil, creditCents = 0, amountCents, paidOn, rateCents }) {
  if (!Number.isInteger(rateCents) || rateCents <= 0) {
    throw new Error('Set a monthly price before recording a payment.')
  }
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error('Enter a payment greater than zero.')
  }
  if (!Number.isInteger(creditCents) || creditCents < 0) {
    throw new Error('Stored credit is invalid.')
  }
  if (!isIsoDate(paidOn)) throw new Error('Enter a valid payment date.')
  if (coveredUntil !== null && coveredUntil !== undefined && !isIsoDate(coveredUntil)) {
    throw new Error('Stored coverage date is invalid.')
  }

  const start = coveredUntil && coveredUntil >= paidOn ? addDays(coveredUntil, 1) : paidOn
  let credit = creditCents + amountCents
  const wholeMonths = Math.floor(credit / rateCents)
  if (wholeMonths > 1200) {
    throw new Error('That payment covers more than 100 years. Check the amount.')
  }
  credit -= wholeMonths * rateCents

  let end = addMonths(start, wholeMonths)
  let daysBought = 0
  if (credit > 0) {
    const nextAnniversary = addMonths(start, wholeMonths + 1)
    const spanDays = diffDays(end, nextAnniversary)
    if (spanDays <= 0) throw new Error('Could not measure that month.')
    daysBought = Math.floor((credit * spanDays) / rateCents)
    const consumed = ceilDiv(daysBought * rateCents, spanDays)
    credit -= consumed
    end = addDays(end, daysBought)
  }

  const extended = wholeMonths > 0 || daysBought > 0
  return {
    coveredUntil: extended ? end : coveredUntil ?? null,
    creditCents: credit,
    extended,
  }
}

export function statusFor({ coveredUntil, creditCents = 0, today }) {
  if (!isIsoDate(today)) throw new Error('Invalid today.')
  const creditText = creditCents > 0 ? `${formatMoney(creditCents)} credit toward the next day.` : ''

  if (!coveredUntil) {
    return {
      tone: 'none',
      daysLabel: 'Not started',
      summary: 'No coverage on file yet.',
      creditText,
    }
  }
  if (!isIsoDate(coveredUntil)) throw new Error('Invalid coverage date.')

  if (coveredUntil < today) {
    return {
      tone: 'passed',
      daysLabel: 'Passed',
      summary: `Paid through ${formatDate(coveredUntil)}. That date has passed.`,
      creditText,
    }
  }

  const next = nextDueDate(coveredUntil)
  const days = diffDays(today, next)
  const unit = days === 1 ? 'day' : 'days'
  return {
    tone: 'covered',
    daysLabel: `${days} ${unit}`,
    summary: `Paid through ${formatDate(coveredUntil)}. Next payment: ${formatDate(next)} (${days} ${unit})`,
    creditText,
  }
}

function ceilDiv(numerator, denominator) {
  return Math.floor((numerator + denominator - 1) / denominator)
}

function isoFromUTC(date) {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
