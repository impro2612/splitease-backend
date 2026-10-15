import { test } from "node:test"
import assert from "node:assert/strict"
import { buildBalanceMap, getNetBalances, getNetPerPerson, getPairwiseNetCents, getUserTotals, simplifyDebts } from "./balance.ts"
import { buildEqualSplits, buildExactSplits, buildPercentageSplits } from "./splits.ts"

const exp = (paidById: string, shares: Record<string, number>) => ({
  paidById,
  splits: Object.entries(shares).map(([userId, amount]) => ({ userId, amount, paid: userId === paidById })),
})
const members = new Set(["A", "B", "C"])

test("pairwise netting and settlement reduce the debt", () => {
  const e = [exp("A", { A: 100, B: 100, C: 100 })]
  assert.deepEqual(getNetBalances(buildBalanceMap(e, [{ fromUserId: "B", toUserId: "A", amount: 100 }], true)),
    [{ fromUserId: "C", toUserId: "A", amountCents: 100 }])
})

test("pairwise view and smart-debt view agree per person, incl. cross-pair settlements", () => {
  const e = [exp("A", { A: 100, B: 100, C: 100 }), exp("B", { A: 50, C: 50 })]
  const s = [{ fromUserId: "C", toUserId: "B", amount: 120 }]
  const pairwise: Record<string, number> = {}
  for (const b of getNetBalances(buildBalanceMap(e, s, true))) {
    pairwise[b.fromUserId] = (pairwise[b.fromUserId] ?? 0) - b.amountCents
    pairwise[b.toUserId] = (pairwise[b.toUserId] ?? 0) + b.amountCents
  }
  for (const [id, net] of getNetPerPerson(e, s, true)) assert.equal(pairwise[id] ?? 0, net, id)
})

test("overpayment is preserved as a reverse debt, not silently dropped", () => {
  const e = [exp("A", { A: 100, B: 100 })]
  const map = buildBalanceMap(e, [{ fromUserId: "B", toUserId: "A", amount: 150 }], true)
  assert.equal(getPairwiseNetCents(map, "A", "B"), 50)
})

test("user totals and simplified debts", () => {
  const e = [exp("A", { A: 100, B: 100, C: 100 })]
  assert.deepEqual(getUserTotals(buildBalanceMap(e, [], true), "A"), { oweCents: 0, owedCents: 200 })
  const simple = simplifyDebts(getNetPerPerson([exp("A", { B: 100 }), exp("B", { C: 100 })], [], true))
  assert.deepEqual(simple, [{ fromUserId: "C", toUserId: "A", amountCents: 100 }])
})

test("exact splits: valid input sums exactly", () => {
  const r = buildExactSplits([{ userId: "A", amount: 33.33 }, { userId: "B", amount: 33.33 }, { userId: "C", amount: 33.34 }], 10000, "A", members)
  assert.ok(r.ok)
  if (r.ok) assert.equal(r.splits.reduce((a, s) => a + s.amount, 0), 10000)
})

test("exact splits: rejects negatives, non-members, duplicates and wrong sums", () => {
  assert.equal(buildExactSplits([{ userId: "A", amount: 15 }, { userId: "B", amount: -5 }], 1000, "A", members).ok, false)
  assert.equal(buildExactSplits([{ userId: "Z", amount: 10 }], 1000, "A", members).ok, false)
  assert.equal(buildExactSplits([{ userId: "A", amount: 5 }, { userId: "A", amount: 5 }], 1000, "A", members).ok, false)
  assert.equal(buildExactSplits([{ userId: "A", amount: 5 }, { userId: "B", amount: 4 }], 1000, "A", members).ok, false)
})

test("percentage and equal splits are exact to the cent", () => {
  const p = buildPercentageSplits([{ userId: "A", percentage: 33.33 }, { userId: "B", percentage: 33.33 }, { userId: "C", percentage: 33.34 }], 1001, "A", members)
  assert.ok(p.ok)
  if (p.ok) assert.equal(p.splits.reduce((a, s) => a + s.amount, 0), 1001)
  assert.equal(buildPercentageSplits([{ userId: "A", percentage: 50 }], 1000, "A", members).ok, false)
  const eq = buildEqualSplits(["A", "B", "C"], 1000, "A", "USD")
  assert.deepEqual(eq.map((s) => s.amount), [334, 333, 333])
  const yen = buildEqualSplits(["A", "B", "C"], 100000, "A", "JPY") // ¥1000 → whole yen only
  assert.deepEqual(yen.map((s) => s.amount), [33400, 33300, 33300])
})
