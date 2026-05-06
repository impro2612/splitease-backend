import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"

export async function GET(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const suggestion = await prisma.personalSuggestion.findUnique({
    where: { userId: user.id },
    select: {
      analyzedMonth: true,
      title: true,
      summary: true,
      recommendations: true,
      updatedAt: true,
    },
  })

  if (!suggestion) {
    return Response.json({
      suggestion: null,
    })
  }

  let recommendations: string[] = []
  try {
    const parsed = JSON.parse(suggestion.recommendations)
    if (Array.isArray(parsed)) recommendations = parsed.map((item) => String(item)).filter(Boolean)
  } catch {
    recommendations = []
  }

  return Response.json({
    suggestion: {
      analyzedMonth: suggestion.analyzedMonth,
      title: suggestion.title,
      summary: suggestion.summary,
      recommendations,
      updatedAt: suggestion.updatedAt,
    },
  })
}
