import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  addMonths,
  applyPayment,
  dollarsToCents,
  statusFor,
} from './coverage.js'

const rate = 500

describe('applyPayment', () => {
  it('covers three months from the payment day through the same day', () => {
    const result = applyPayment({
      coveredUntil: null,
      amountCents: 1500,
      paidOn: '2026-09-26',
      rateCents: rate,
    })
    assert.equal(result.coveredUntil, '2026-12-26')
    assert.equal(result.creditCents, 0)
    assert.equal(statusFor({ ...result, today: '2026-09-26' }).summary,
      'Paid through Dec 26, 2026. Next payment: Dec 27, 2026 (92 days)')
  })

  it('stacks a new payment onto the day after current coverage', () => {
    const result = applyPayment({
      coveredUntil: '2026-12-26',
      amountCents: 500,
      paidOn: '2026-11-01',
      rateCents: rate,
    })
    assert.equal(result.coveredUntil, '2027-01-27')
    assert.equal(statusFor({ ...result, today: '2026-11-01' }).summary,
      'Paid through Jan 27, 2027. Next payment: Jan 28, 2027 (88 days)')
  })

  it('starts on the payment date after coverage has lapsed', () => {
    const result = applyPayment({
      coveredUntil: '2026-08-01',
      amountCents: 500,
      paidOn: '2026-09-26',
      rateCents: rate,
    })
    assert.equal(result.coveredUntil, '2026-10-26')
    assert.equal(statusFor({ ...result, today: '2026-09-26' }).summary,
      'Paid through Oct 26, 2026. Next payment: Oct 27, 2026 (31 days)')
  })

  it('buys extra days with money left after whole months and keeps leftover cents', () => {
    const result = applyPayment({
      coveredUntil: null,
      amountCents: 700,
      paidOn: '2026-09-26',
      rateCents: rate,
    })
    assert.equal(result.coveredUntil, '2026-11-07')
    assert.equal(result.creditCents, 6)
    assert.equal(statusFor({ ...result, today: '2026-09-26' }).creditText,
      '$0.06 credit toward the next day.')
  })

  it('lands a January 31 payment on the last day of February', () => {
    const commonYear = applyPayment({
      coveredUntil: null,
      amountCents: 500,
      paidOn: '2026-01-31',
      rateCents: rate,
    })
    assert.equal(commonYear.coveredUntil, '2026-02-28')

    const leapYear = applyPayment({
      coveredUntil: null,
      amountCents: 500,
      paidOn: '2024-01-31',
      rateCents: rate,
    })
    assert.equal(leapYear.coveredUntil, '2024-02-29')
    assert.equal(addMonths('2026-01-31', 1), '2026-02-28')
    assert.equal(addMonths('2024-01-31', 1), '2024-02-29')
  })

  it('keeps cents that do not buy a full day, then applies them to the next payment', () => {
    const first = applyPayment({
      coveredUntil: null,
      amountCents: 1,
      paidOn: '2026-09-26',
      rateCents: rate,
    })
    assert.equal(first.extended, false)
    assert.equal(first.coveredUntil, null)
    assert.equal(first.creditCents, 1)

    const second = applyPayment({
      coveredUntil: first.coveredUntil,
      creditCents: first.creditCents,
      amountCents: 499,
      paidOn: '2026-09-26',
      rateCents: rate,
    })
    assert.equal(second.coveredUntil, '2026-10-26')
    assert.equal(second.creditCents, 0)
  })

  it('says a passed date has passed, without a balance due', () => {
    const status = statusFor({
      coveredUntil: '2026-08-01',
      creditCents: 0,
      today: '2026-09-26',
    })
    assert.equal(status.summary, 'Paid through Aug 1, 2026. That date has passed.')
    assert.equal(status.summary.includes('owe'), false)
  })
})

describe('dollarsToCents', () => {
  it('accepts dollars and cents and rejects empty or oversized amounts', () => {
    assert.equal(dollarsToCents('15'), 1500)
    assert.equal(dollarsToCents('15.5'), 1550)
    assert.equal(dollarsToCents('15.00'), 1500)
    assert.equal(dollarsToCents('15.50'), 1550)
    assert.equal(dollarsToCents('0'), null)
    assert.equal(dollarsToCents('15.555'), null)
    assert.equal(dollarsToCents('abc'), null)
  })
})
