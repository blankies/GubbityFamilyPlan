# Family plan coverage

A small private page for one monthly price. You sign in and record payments. Each person gets a link that shows the date they are paid through and when the next payment is due.

A $15 payment on Sep 26, at $5 a month, is paid through Dec 26. The next payment is due Dec 27.

## Setup

1. Install Node.js 18 or newer.
2. Copy `.env.example` to `.env`.
3. Set `OWNER_PASSWORD` and a `SESSION_SECRET` of at least 16 characters.
4. From this folder, run:

```
npm install
npm start
```

5. Open http://localhost:3000, set the monthly price, add people, and set paid-through dates for anyone already covered.

Share the private link from each person's card. Use New link if an old link should stop working. Open the site from an address other people can reach before you copy links, so the link is not stuck on localhost.

`TIMEZONE` controls which calendar day counts as today. It defaults to `America/Denver`.

Coverage is stored in `data/plan.json` on this computer.
