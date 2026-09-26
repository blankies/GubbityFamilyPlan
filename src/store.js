import fs from 'node:fs'
import path from 'node:path'
import { isIsoDate } from './coverage.js'

export function createStore(filePath) {
  let chain = Promise.resolve()

  function read() {
    let raw
    try {
      raw = fs.readFileSync(filePath, 'utf8')
    } catch (error) {
      if (error.code === 'ENOENT') return emptyPlan()
      throw error
    }
    try {
      return normalize(JSON.parse(raw))
    } catch {
      throw new Error(`${filePath} could not be read.`)
    }
  }

  function update(mutator) {
    const run = chain.then(() => {
      const data = read()
      const result = mutator(data)
      writeAtomic(filePath, `${JSON.stringify(data, null, 2)}\n`)
      return result
    })
    chain = run.then(() => {}, () => {})
    return run
  }

  return { read, update }
}

function emptyPlan() {
  return { monthlyRateCents: null, members: [] }
}

function normalize(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.members)) {
    throw new Error('Plan file is missing its member list.')
  }
  const rate = data.monthlyRateCents
  return {
    monthlyRateCents: Number.isInteger(rate) && rate > 0 ? rate : null,
    members: data.members.map(normalizeMember),
  }
}

function normalizeMember(member) {
  return {
    id: String(member.id),
    name: String(member.name),
    token: String(member.token),
    coveredUntil: isIsoDate(member.coveredUntil) ? member.coveredUntil : null,
    creditCents: Number.isInteger(member.creditCents) && member.creditCents > 0 ? member.creditCents : 0,
    history: Array.isArray(member.history) ? member.history : [],
  }
}

function writeAtomic(filePath, contents) {
  const dir = path.dirname(filePath)
  fs.mkdirSync(dir, { recursive: true })
  const tmp = `${filePath}.${process.pid}.tmp`
  const fd = fs.openSync(tmp, 'w')
  try {
    fs.writeSync(fd, contents)
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  fs.copyFileSync(tmp, filePath)
  fs.rmSync(tmp, { force: true })
}
