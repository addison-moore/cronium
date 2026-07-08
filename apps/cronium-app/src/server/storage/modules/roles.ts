import { db } from "../../db";
import { roles } from "../../../shared/schema";
import { eq, sql } from "drizzle-orm";

export type Role = typeof roles.$inferSelect;

export interface RolePermissions {
  console: boolean;
  monitoring: boolean;
  localServerAccess: boolean;
}

export class RolesStorage {
  async listRoles(): Promise<Role[]> {
    return db.select().from(roles).orderBy(roles.id);
  }

  async getRoleById(id: number): Promise<Role | undefined> {
    const [role] = await db.select().from(roles).where(eq(roles.id, id));
    return role;
  }

  async getRoleByName(name: string): Promise<Role | undefined> {
    const [role] = await db
      .select()
      .from(roles)
      .where(sql`lower(${roles.name}) = ${name.toLowerCase()}`);
    return role;
  }

  async getDefaultRole(): Promise<Role | undefined> {
    const [role] = await db
      .select()
      .from(roles)
      .where(eq(roles.isDefault, true));
    return role;
  }

  async updateRolePermissions(
    id: number,
    permissions: RolePermissions,
  ): Promise<Role | undefined> {
    const [updated] = await db
      .update(roles)
      .set({ permissions, updatedAt: new Date() })
      .where(eq(roles.id, id))
      .returning();
    return updated;
  }
}
