import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { isAllowedInstitutionEmail } from "./auth-policy";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Variabile mancante: ${name}.`);
  }
  return value;
}

export function getAuthOptions(): NextAuthOptions {
  return {
    session: {
      strategy: "jwt",
    },
    providers: [
      GoogleProvider({
        clientId: requiredEnv("GOOGLE_CLIENT_ID"),
        clientSecret: requiredEnv("GOOGLE_CLIENT_SECRET"),
      }),
    ],
    callbacks: {
      async signIn({ account, profile }) {
        if (account?.provider !== "google") return false;
        const email = profile?.email?.toLowerCase();
        return isAllowedInstitutionEmail(email);
      },
    },
    pages: {
      signIn: "/",
      error: "/",
    },
    secret: requiredEnv("NEXTAUTH_SECRET"),
  };
}
