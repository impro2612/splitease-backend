import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"
import { normalizePhone } from "@/lib/phone"

// POST /api/users/lookup-phones
// Body: { phones: string[] }  — normalized phone numbers
// Returns: { [phone]: { id, name, email, image } }  — only matched ones
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { phones } = await req.json()
  if (!Array.isArray(phones) || phones.length === 0) return Response.json({})

  // Limit to 500 to avoid abuse
  const limited = phones
    .slice(0, 500)
    .map((phone) => normalizePhone(String(phone ?? "")))
    .filter(Boolean)

  if (limited.length === 0) return Response.json({})

  const users = await prisma.user.findMany({
    where: {
      phoneNormalized: { in: limited },
      id: { not: user.id },
    },
    select: { id: true, name: true, email: true, image: true, phoneNormalized: true },
  })

  // Return as a map: phone -> user info
  const result: Record<string, { id: string; name: string | null; email: string; image: string | null }> = {}
  for (const u of users) {
    if (u.phoneNormalized) {
      result[u.phoneNormalized] = { id: u.id, name: u.name, email: u.email, image: u.image }
    }
  }

  return Response.json(result)
}
