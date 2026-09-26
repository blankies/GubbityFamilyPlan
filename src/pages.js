import { addDays, centsToInput, statusFor } from './coverage.js'

export function renderLogin({ error = '' } = {}) {
  return layout({
    title: 'Sign in',
    body: `
      <main class="gate">
        <p class="eyebrow">Family plan</p>
        <h1>Sign in</h1>
        <p class="lede">Only you can update who is paid up.</p>
        ${banner(error)}
        <form method="post" action="/login" class="stack">
          <label for="password">Password</label>
          <input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
          <button type="submit">Continue</button>
        </form>
      </main>`,
  })
}

export function renderOwner({ plan, today, origin, timeZone, flash = '' }) {
  const rateValue = plan.monthlyRateCents ? centsToInput(plan.monthlyRateCents) : ''
  const members = [...plan.members].sort((a, b) => compareMembers(a, b, today))
  const cards = members.length
    ? members.map((member) => memberCard(member, { today, origin })).join('')
    : '<p class="empty">No one is on the plan yet.</p>'

  return layout({
    title: 'Coverage',
    body: `
      <main class="app">
        <header class="top">
          <div>
            <p class="eyebrow">Family plan</p>
            <h1>Coverage</h1>
          </div>
          <form method="post" action="/logout">
            <button type="submit" class="quiet">Sign out</button>
          </form>
        </header>
        ${banner(flash)}
        <section class="panel">
          <h2>Monthly price</h2>
          <form method="post" action="/rate" class="inline">
            <label for="rate">Dollars per month
              <input id="rate" name="amount" inputmode="decimal" autocomplete="off" placeholder="5.00" value="${escapeHtml(rateValue)}" required>
            </label>
            <button type="submit">Save price</button>
          </form>
          <p class="hint">Changing the price does not rewrite coverage already recorded. Dates use ${escapeHtml(timeZone)}.</p>
        </section>
        <section class="panel">
          <h2>Add someone</h2>
          <form method="post" action="/members" class="inline">
            <label for="name">Name
              <input id="name" name="name" maxlength="80" autocomplete="off" required>
            </label>
            <button type="submit">Add</button>
          </form>
        </section>
        <section class="roster">
          <h2>Everyone</h2>
          ${cards}
        </section>
      </main>
      <script>
        document.addEventListener('click', (event) => {
          const button = event.target.closest('[data-copy]')
          if (!button) return
          const field = document.getElementById(button.getAttribute('data-copy'))
          if (!field) return
          field.select()
          navigator.clipboard.writeText(field.value).then(() => {
            const previous = button.textContent
            button.textContent = 'Copied'
            setTimeout(() => { button.textContent = previous }, 1200)
          }).catch(() => {})
        })
      </script>`,
  })
}

export function renderMember(member, { today }) {
  const status = memberStatus(member, today)
  const credit = status.creditText ? `<p class="credit">${escapeHtml(status.creditText)}</p>` : ''
  return layout({
    title: member.name,
    body: `
      <main class="status">
        <p class="eyebrow">Family plan</p>
        <h1>${escapeHtml(member.name)}</h1>
        <p class="summary">${escapeHtml(status.summary)}</p>
        ${credit}
      </main>`,
  })
}

export function renderMissing() {
  return layout({
    title: 'Link not found',
    status: 404,
    body: `
      <main class="gate">
        <p class="eyebrow">Family plan</p>
        <h1>Link not found</h1>
        <p class="lede">This page is not on the plan. Ask for a new link.</p>
      </main>`,
  })
}

export function renderError() {
  return layout({
    title: 'Something went wrong',
    body: `
      <main class="gate">
        <p class="eyebrow">Family plan</p>
        <h1>Something went wrong</h1>
        <p class="lede">Reload the page and try that again.</p>
      </main>`,
  })
}

function memberCard(member, { today, origin }) {
  const status = memberStatus(member, today)
  const link = `${origin}/m/${member.token}`
  const linkId = `link-${member.id}`
  const coveredValue = member.coveredUntil || ''
  const undo = member.history.length
    ? '<button type="submit" class="quiet">Undo last change</button>'
    : '<button type="submit" class="quiet" disabled>Undo last change</button>'

  return `
    <article class="card tone-${status.tone}">
      <details>
        <summary>
          <div class="card-head">
            <h3>${escapeHtml(member.name)}</h3>
            <p class="days">${escapeHtml(status.daysLabel)}</p>
          </div>
          <p class="summary">${escapeHtml(status.summary)}</p>
        </summary>
        <div class="card-more">
      ${status.creditText ? `<p class="credit">${escapeHtml(status.creditText)}</p>` : ''}
      <form method="post" action="/members/${escapeHtml(member.id)}/pay" class="inline">
        <label for="amount-${escapeHtml(member.id)}">Payment
          <input id="amount-${escapeHtml(member.id)}" name="amount" inputmode="decimal" autocomplete="off" placeholder="15.00" required>
        </label>
        <label for="date-${escapeHtml(member.id)}">Date
          <input id="date-${escapeHtml(member.id)}" name="date" type="date" value="${escapeHtml(today)}" required>
        </label>
        <button type="submit">Record payment</button>
      </form>
      <form method="post" action="/members/${escapeHtml(member.id)}/coverage" class="inline">
        <label for="until-${escapeHtml(member.id)}">Paid through
          <input id="until-${escapeHtml(member.id)}" name="until" type="date" value="${escapeHtml(coveredValue)}" required>
        </label>
        <button type="submit">Set date</button>
      </form>
      <div class="link-row">
        <label for="${linkId}">Private link
          <input id="${linkId}" readonly value="${escapeHtml(link)}">
        </label>
        <button type="button" data-copy="${escapeHtml(linkId)}">Copy link</button>
      </div>
      <div class="row-actions">
        <form method="post" action="/members/${escapeHtml(member.id)}/relink" onsubmit="return confirm('Replace their link? The old one will stop working.')">
          <button type="submit" class="quiet">New link</button>
        </form>
        <form method="post" action="/members/${escapeHtml(member.id)}/undo">
          ${undo}
        </form>
      </div>
        </div>
      </details>
    </article>`
}

function compareMembers(a, b, today) {
  const aKey = a.coveredUntil ? addDays(a.coveredUntil, 1) : today
  const bKey = b.coveredUntil ? addDays(b.coveredUntil, 1) : today
  if (aKey !== bKey) return aKey < bKey ? -1 : 1
  return a.name.localeCompare(b.name)
}

function memberStatus(member, today) {
  return statusFor({
    coveredUntil: member.coveredUntil,
    creditCents: member.creditCents,
    today,
  })
}

function layout({ title, body }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
${body}
</body>
</html>`
}

function banner(message) {
  if (!message) return ''
  return `<p class="banner" role="status">${escapeHtml(message)}</p>`
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
