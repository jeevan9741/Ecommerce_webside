import { auth } from "@/lib/auth";

export class UnauthorizedError extends Error {
  status = 401;
}
export class ForbiddenError extends Error {
  status = 403;
}

export async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new UnauthorizedError("Sign in required");
  return session.user;
}

export async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "ADMIN") throw new ForbiddenError("Admin access required");
  return user;
}
