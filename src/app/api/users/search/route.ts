import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"

export async function GET(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const q = req.nextUrl.searchParams.get("q")
  if (!q || q.length < 2) return Response.json([])

  const users = await prisma.user.findMany({
    where: {
      AND: [
        { id: { not: user.id } },
        {
          OR: [
            { email: { contains: q } },
            { name: { contains: q } },
          ],
        },
      ],
    },
    select: { id: true, name: true, email: true, image: true },
    take: 10,
  })

  return Response.json(users)
}
