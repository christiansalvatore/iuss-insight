import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

import { getWeeklyQuotaStatus } from "../../../lib/weekly-quota";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const token = await getToken({
      req: request,
      secret: process.env.NEXTAUTH_SECRET,
    });
    const sessionEmail = typeof token?.email === "string" ? token.email.toLowerCase() : "";
    if (!sessionEmail || !sessionEmail.endsWith("@gmail.com")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const quota = await getWeeklyQuotaStatus(sessionEmail);
    return NextResponse.json(quota);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Errore quota";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

