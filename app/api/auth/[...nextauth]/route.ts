import NextAuth from "next-auth";

import { getAuthOptions } from "../../../../lib/auth";

const handler = async (request: Request, context: unknown) => {
  const authHandler = NextAuth(getAuthOptions());
  return authHandler(request, context);
};

export { handler as GET, handler as POST };
