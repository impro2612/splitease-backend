import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/mobile-auth"
import { requirePlus } from "@/lib/plus"
import { prisma } from "@/lib/prisma"
import { parseMonth } from "@/lib/month"

export async function GET(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const locked = await requirePlus(user.id)
  if (locked) return locked

  const { searchParams } = new URL(req.url)
  const month = searchParams.get("month")?.trim()
  if (!month || !parseMonth(month)) {
    return Response.json({ error: "month must be YYYY-MM" }, { status: 400 })
  }

  const suggestion = await prisma.personalSuggestion.findUnique({
    where: {
      userId_analyzedMonth: {
        userId: user.id,
        analyzedMonth: month,
      },
    },
    select: {
      analyzedMonth: true,
      title: true,
      summary: true,
      source: true,
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
      source: suggestion.source,
      recommendations,
      updatedAt: suggestion.updatedAt,
    },
  })
}
