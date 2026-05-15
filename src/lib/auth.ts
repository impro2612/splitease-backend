import NextAuth, { type Session } from "next-auth"
import type { JWT } from "next-auth/jwt"
import { PrismaAdapter } from "@auth/prisma-adapter"
import CredentialsProvider from "next-auth/providers/credentials"
import GoogleProvider from "next-auth/providers/google"
import bcrypt from "bcryptjs"
import { prisma } from "./prisma"

// How often to re-validate the password anchor against the DB (5 minutes)
const SESSION_CHECK_INTERVAL_MS = 5 * 60 * 1000

export const authOptions = {
  adapter: PrismaAdapter(prisma),
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    }),
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null

        const user = await prisma.user.findUnique({
          where: { email: credentials.email as string },
        })

        if (!user || !user.password) return null

        const isValid = await bcrypt.compare(
          credentials.password as string,
          user.password
        )

        if (!isValid) return null

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          // First 10 chars of bcrypt hash stored in JWT so we can detect stale sessions
          pwHashPrefix: user.password?.slice(0, 10) ?? "",
        }
      },
    }),
  ],
  session: { strategy: "jwt" as const },
  pages: {
    signIn: "/signin",
    newUser: "/dashboard",
  },
  callbacks: {
    async jwt({ token, user }: { token: JWT; user?: { id?: string; pwHashPrefix?: string } }) {
      if (user) {
        // Initial sign-in: embed the password hash prefix anchor
        token.id = user.id
        if (user.pwHashPrefix !== undefined) token.pwHashPrefix = user.pwHashPrefix
        token.lastChecked = Date.now()
        return token
      }

      // Subsequent requests: re-validate against DB every SESSION_CHECK_INTERVAL_MS
      // Only applies to credentials sessions (Google sessions have no pwHashPrefix)
      const lastChecked = (token.lastChecked as number) ?? 0
      if (typeof token.pwHashPrefix === "string" && Date.now() - lastChecked > SESSION_CHECK_INTERVAL_MS) {
        const dbUser = await prisma.user.findUnique({
          where: { id: token.id as string },
          select: { password: true },
        })
        // User deleted or password changed — expire the token immediately so the next
        // request redirects to sign-in. NextAuth v4 respects exp=0 as "expired".
        if (!dbUser || (dbUser.password?.slice(0, 10) ?? "") !== token.pwHashPrefix) {
          return { ...token, exp: 0 }
        }
        token.lastChecked = Date.now()
      }

      return token
    },
    async session({ session, token }: { session: Session; token: JWT }) {
      if (token && session.user) {
        session.user.id = token.id as string
      }
      return session
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
}

export const { handlers, signIn, signOut, auth } = NextAuth(authOptions)
