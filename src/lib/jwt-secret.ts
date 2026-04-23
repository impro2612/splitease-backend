const nextAuthSecret = process.env.NEXTAUTH_SECRET?.trim()

if (!nextAuthSecret) {
  throw new Error("NEXTAUTH_SECRET is required for mobile JWT authentication")
}

export const MOBILE_JWT_SECRET = new TextEncoder().encode(nextAuthSecret)
