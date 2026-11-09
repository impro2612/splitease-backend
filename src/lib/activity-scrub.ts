/**
 * Activity.meta carries display names captured at the time (toUserName, recordedBy,
 * old/newPaidByName…). When an account is deleted those names must go too.
 */
export const DELETED_USER_NAME = "Deleted user"

const NAME_KEYS = ["toUserName", "fromUserName", "oldPaidByName", "newPaidByName", "recordedBy", "memberName"] as const

/**
 * Returns the scrubbed meta JSON, or null when nothing needed changing.
 * `isTarget` = the deleted user is this activity's targetUserId, so its toUserName is
 * theirs even if it was captured under an older display name.
 */
export function scrubActivityMeta(meta: string, oldName: string, isTarget: boolean): string | null {
  let parsed: unknown
  try { parsed = JSON.parse(meta) } catch { return null }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null
  const obj = parsed as Record<string, unknown>
  let changed = false
  for (const key of NAME_KEYS) {
    const v = obj[key]
    if (typeof v !== "string" || v === DELETED_USER_NAME) continue
    if (v === oldName || (key === "toUserName" && isTarget)) {
      obj[key] = DELETED_USER_NAME
      changed = true
    }
  }
  return changed ? JSON.stringify(obj) : null
}
