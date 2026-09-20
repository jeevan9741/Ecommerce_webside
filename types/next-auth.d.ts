import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: "USER" | "ADMIN";
      referralCode: string;
    } & DefaultSession["user"];
  }

  interface User {
    role: "USER" | "ADMIN";
    referralCode: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: "USER" | "ADMIN";
    referralCode: string;
  }
}
