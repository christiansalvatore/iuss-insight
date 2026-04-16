import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

import { getUserAccessStats } from "../../../lib/access-log";
import { isAllowedInstitutionEmail } from "../../../lib/auth-policy";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const token = await getToken({
      req: request,
      secret: process.env.NEXTAUTH_SECRET,
    });

    const email = typeof token?.email === "string" ? token.email.toLowerCase() : "";
    if (!isAllowedInstitutionEmail(email)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const stats = await getUserAccessStats(email);
    return NextResponse.json(stats);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Errore access log";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

