import type { UserRole, UserStatus } from "@/shared/schema";
import "next-auth";

declare module "next-auth" {
  interface User {
    id: string;
    email?: string | null;
    username?: string | null;
    role: UserRole;
    status: UserStatus;
    firstName?: string | null;
    lastName?: string | null;
    profileImageUrl?: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    email?: string | null;
    username?: string | null;
    role: UserRole;
    status: UserStatus;
    firstName?: string | null;
    lastName?: string | null;
    profileImageUrl?: string | null;
  }
}

declare module "next-auth/core/types" {
  interface Session {
    user: {
      id: string;
      email?: string | null;
      username?: string | null;
      role: UserRole;
      status: UserStatus;
      firstName?: string | null;
      lastName?: string | null;
      profileImageUrl?: string | null;
    };
  }
}
