import type { Prisma } from "@/generated/prisma/client"
import { groupPhotoUrl } from "./group-image"

// Photos users upload themselves live in GroupPhoto and are referenced only by the
// group's imageUrl, so when that URL changes or the group goes, the row would be orphaned.

const PHOTO_PATH = "/api/group-photo/"

/** The GroupPhoto id behind an own-upload URL, or null for external / missing images. */
export function groupPhotoIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null
  const i = url.indexOf(PHOTO_PATH)
  if (i < 0) return null
  const id = url.slice(i + PHOTO_PATH.length)
  // Only a bare id: no query string, path tail or anything else that isn't ours
  return /^[a-z0-9]+$/.test(id) && url === groupPhotoUrl(id) ? id : null
}

/** Deletes the photo row unless some other group still shows it (a copied URL). */
export async function deleteGroupPhotoIfUnused(tx: Prisma.TransactionClient, photoId: string): Promise<boolean> {
  const stillUsed = await tx.group.count({ where: { imageUrl: groupPhotoUrl(photoId) } })
  if (stillUsed > 0) return false
  await tx.groupPhoto.deleteMany({ where: { id: photoId } }) // deleteMany: no throw if already gone
  return true
}
