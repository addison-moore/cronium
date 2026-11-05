import type { UserRole, UserStatus } from "@/shared/schema";
import "next-auth";

declare module "next-auth" {
  interface User {
    id: string;
    email?: string | null;
    username?: string | null;
    role: UserRole;
    status: UserStatus;
    sessionVersion: number;
    firstName?: string | null;
    lastName?: string | null;
    profileImageUrl?: string | null;
  }

  interface Session {
    user: User;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    email?: string | null;
    username?: string | null;
    role: UserRole;
    status: UserStatus;
    sessionVersion: number;
    firstName?: string | null;
    lastName?: string | null;
    profileImageUrl?: string | null;
  }
}
