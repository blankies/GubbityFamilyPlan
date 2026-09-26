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

<img width="597" height="742" alt="firefox_U0eopn06eg" src="https://github.com/user-attachments/assets/1274a0ea-fd1e-4222-90ac-55b181ea5f58" />
<img width="867" height="882" alt="firefox_Otvvj9ufwK" src="https://github.com/user-attachments/assets/8e257dce-1574-4b6c-9d56-c345dff8d3f4" />
<img width="792" height="913" alt="firefox_tgtCOFOTH7" src="https://github.com/user-attachments/assets/8279e8c4-a842-4fe1-b8b8-0246189bb409" />
<img width="787" height="429" alt="firefox_ja0TMAIcKW" src="https://github.com/user-attachments/assets/f1b7c332-430b-493e-a13b-608793250621" />

