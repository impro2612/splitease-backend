import { test } from "node:test"
import assert from "node:assert/strict"
import {
  chunk,
  EXPO_SEND_CHUNK,
  isExpoToken,
  maskToken,
  parseReceipts,
  parseTickets,
  type PushMessage,
} from "./push-core.ts"

const msg = (to: string): PushMessage => ({ to, title: "t", body: "b" })

test("isExpoToken accepts both Expo token prefixes and rejects junk", () => {
  assert.equal(isExpoToken("ExponentPushToken[abcdefghijklmnopqrstuv]"), true)
  assert.equal(isExpoToken("ExpoPushToken[abcdefghijklmnopqrstuv]"), true)
  assert.equal(isExpoToken("ExponentPushToken[]"), false)
  assert.equal(isExpoToken("ExponentPushToken[abc]extra"), false)
  assert.equal(isExpoToken("fcm:abcdef"), false)
  assert.equal(isExpoToken(""), false)
  assert.equal(isExpoToken(undefined), false)
  assert.equal(isExpoToken(42), false)
})

test("chunk splits into groups of at most size, preserving order", () => {
  assert.deepEqual(chunk([], 3), [])
  assert.deepEqual(chunk([1, 2, 3], 3), [[1, 2, 3]])
  assert.deepEqual(chunk([1, 2, 3, 4], 3), [[1, 2, 3], [4]])
  const many = Array.from({ length: 250 }, (_, i) => i)
  const groups = chunk(many, EXPO_SEND_CHUNK)
  assert.equal(groups.length, 3)
  assert.deepEqual(groups.map((g) => g.length), [100, 100, 50])
  assert.deepEqual(groups.flat(), many)
  assert.throws(() => chunk([1], 0), RangeError)
})

test("maskToken keeps only the first 8 chars of the inner id", () => {
  assert.equal(maskToken("ExponentPushToken[abcdefghijklmnop]"), "ExponentPushToken[abcdefgh…]")
  assert.equal(maskToken("ExpoPushToken[abcdefghijklmnop]"), "ExpoPushToken[abcdefgh…]")
  assert.equal(maskToken("ExponentPushToken[abc]"), "ExponentPushToken[abc…]")
  assert.equal(maskToken("something-else-entirely"), "somethin…")
})

test("parseTickets maps ok / stale / error tickets by index", () => {
  const sent = [msg("ExponentPushToken[aaaaaaaa1]"), msg("ExponentPushToken[bbbbbbbb2]"), msg("ExponentPushToken[cccccccc3]")]
  const response = {
    data: [
      { status: "ok", id: "ticket-1" },
      { status: "error", message: "not registered", details: { error: "DeviceNotRegistered" } },
      { status: "error", message: "too big", details: { error: "MessageTooBig" } },
    ],
  }
  const r = parseTickets(sent, response)
  assert.deepEqual(r.okTickets, [{ id: "ticket-1", token: "ExponentPushToken[aaaaaaaa1]" }])
  assert.deepEqual(r.staleTokens, ["ExponentPushToken[bbbbbbbb2]"])
  assert.deepEqual(r.errors, [{ token: "ExponentPushToken[cccccccc3]", message: "too big", error: "MessageTooBig" }])
})

test("parseTickets surfaces request-level errors and malformed bodies without throwing", () => {
  const sent = [msg("ExponentPushToken[aaaaaaaa1]")]
  const reqErr = parseTickets(sent, { errors: [{ code: "PUSH_TOO_MANY_EXPERIENCE_IDS", message: "mixed projects" }] })
  assert.deepEqual(reqErr.okTickets, [])
  assert.deepEqual(reqErr.errors, [{ token: null, message: "mixed projects", error: "PUSH_TOO_MANY_EXPERIENCE_IDS" }])

  for (const bad of [null, undefined, "nope", 7, [], {}, { data: "x" }]) {
    const r = parseTickets(sent, bad)
    assert.deepEqual(r.okTickets, [])
    assert.deepEqual(r.staleTokens, [])
    assert.equal(r.errors.length, 1)
    assert.equal(r.errors[0].token, null)
  }

  // Ticket without a matching message (index overflow) is ignored; a non-object ticket is an error
  const r = parseTickets(sent, { data: [null, { status: "ok", id: "orphan" }] })
  assert.deepEqual(r.okTickets, [])
  assert.deepEqual(r.errors, [{ token: "ExponentPushToken[aaaaaaaa1]", message: "malformed ticket" }])
})

test("parseTickets dedupes stale tokens and treats errors without a code as plain errors", () => {
  const tok = "ExponentPushToken[dddddddd4]"
  const r = parseTickets([msg(tok), msg(tok), msg("ExponentPushToken[eeeeeeee5]")], {
    data: [
      { status: "error", details: { error: "DeviceNotRegistered" } },
      { status: "error", details: { error: "DeviceNotRegistered" } },
      { status: "error", message: "boom" },
    ],
  })
  assert.deepEqual(r.staleTokens, [tok])
  assert.deepEqual(r.errors, [{ token: "ExponentPushToken[eeeeeeee5]", message: "boom", error: undefined }])
})

test("parseReceipts maps receipts by ticket id and leaves missing ones pending", () => {
  const tickets = [
    { id: "t-ok", token: "ExponentPushToken[aaaaaaaa1]" },
    { id: "t-stale", token: "ExponentPushToken[bbbbbbbb2]" },
    { id: "t-err", token: "ExponentPushToken[cccccccc3]" },
    { id: "t-pending", token: "ExponentPushToken[dddddddd4]" },
  ]
  const r = parseReceipts(tickets, {
    data: {
      "t-ok": { status: "ok" },
      "t-stale": { status: "error", message: "gone", details: { error: "DeviceNotRegistered" } },
      "t-err": { status: "error", message: "bad creds", details: { error: "InvalidCredentials" } },
    },
  })
  assert.deepEqual(r.processedIds, ["t-ok", "t-stale", "t-err"])
  assert.deepEqual(r.staleTokens, ["ExponentPushToken[bbbbbbbb2]"])
  assert.deepEqual(r.errors, [{ token: "ExponentPushToken[cccccccc3]", message: "bad creds", error: "InvalidCredentials" }])
})

test("parseReceipts handles malformed responses without throwing", () => {
  const tickets = [{ id: "t1", token: "ExponentPushToken[aaaaaaaa1]" }]
  for (const bad of [null, "x", { data: [] }, { data: null }, {}]) {
    const r = parseReceipts(tickets, bad)
    assert.deepEqual(r.processedIds, [])
    assert.equal(r.errors.length, 1)
    assert.equal(r.errors[0].token, null)
  }
  const r = parseReceipts(tickets, { data: { t1: "weird" } })
  assert.deepEqual(r.processedIds, ["t1"])
  assert.deepEqual(r.errors, [{ token: "ExponentPushToken[aaaaaaaa1]", message: "malformed receipt" }])
})
