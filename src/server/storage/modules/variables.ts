import { db } from "../../db";
import {
  envVars,
  userVariables,
  EnvVar,
  InsertEnvVar,
  UserVariable,
  InsertUserVariable,
} from "../../../shared/schema";
import { eq, and, asc } from "drizzle-orm";
import {
  encryptSensitiveData,
  decryptSensitiveData,
} from "../../../lib/encryption-service";

export class VariablesStorage {
  // Environment variable methods
  async getEnvVars(eventId: number): Promise<EnvVar[]> {
    const vars = await db
      .select()
      .from(envVars)
      .where(eq(envVars.eventId, eventId));

    // Decrypt sensitive environment variable values
    return vars.map((envVar) => {
      try {
        return decryptSensitiveData(envVar, "envVars");
      } catch (error) {
        console.error(`Error decrypting env var for event ${eventId}:`, error);
        // Return env var without decryption rather than failing
        return envVar;
      }
    });
  }

  async createEnvVar(insertEnvVar: InsertEnvVar): Promise<EnvVar> {
    // Encrypt sensitive environment variable data before storing
    const encryptedData = encryptSensitiveData(insertEnvVar, "envVars");

    const [envVar] = await db.insert(envVars).values(encryptedData).returning();

    if (!envVar) {
      throw new Error("Failed to create environment variable");
    }

    // Return decrypted data for immediate use
    return decryptSensitiveData<EnvVar>(envVar, "envVars");
  }

  async deleteEnvVarsByEventId(eventId: number): Promise<void> {
    await db.delete(envVars).where(eq(envVars.eventId, eventId));
  }

  // User variables methods for cronium.getVariable() and cronium.setVariable()
  async getUserVariable(
    userId: string,
    key: string,
  ): Promise<UserVariable | undefined> {
    const [variable] = await db
      .select()
      .from(userVariables)
      .where(and(eq(userVariables.userId, userId), eq(userVariables.key, key)));

    return variable ?? undefined;
  }

  async setUserVariable(
    userId: string,
    key: string,
    value: string,
    description?: string,
  ): Promise<UserVariable> {
    // Try to update existing variable first
    const existingVariable = await this.getUserVariable(userId, key);

    if (existingVariable) {
      const [updatedVariable] = await db
        .update(userVariables)
        .set({
          value,
          description: description ?? existingVariable.description,
          updatedAt: new Date(),
        })
        .where(
          and(eq(userVariables.userId, userId), eq(userVariables.key, key)),
        )
        .returning();

      if (!updatedVariable) {
        throw new Error("Failed to update user variable");
      }
      return updatedVariable;
    } else {
      // Create new variable
      const [newVariable] = await db
        .insert(userVariables)
        .values({
          userId,
          key,
          value,
          description,
        })
        .returning();

      if (!newVariable) {
        throw new Error("Failed to create user variable");
      }
      return newVariable;
    }
  }

  async getUserVariables(userId: string): Promise<UserVariable[]> {
    const variables = await db
      .select()
      .from(userVariables)
      .where(eq(userVariables.userId, userId))
      .orderBy(asc(userVariables.key));

    return variables;
  }

  async createUserVariable(
    insertVariable: InsertUserVariable,
  ): Promise<UserVariable> {
    const [variable] = await db
      .insert(userVariables)
      .values(insertVariable)
      .returning();

    if (!variable) {
      throw new Error("Failed to create user variable");
    }
    return variable;
  }

  async updateUserVariable(
    id: number,
    userId: string,
    updateData: Partial<InsertUserVariable>,
  ): Promise<UserVariable | null> {
    const [variable] = await db
      .update(userVariables)
      .set(updateData)
      .where(and(eq(userVariables.id, id), eq(userVariables.userId, userId)))
      .returning();

    return variable ?? null;
  }

  async deleteUserVariable(id: number, userId: string): Promise<boolean> {
    const result = await db
      .delete(userVariables)
      .where(and(eq(userVariables.id, id), eq(userVariables.userId, userId)));

    return (result.rowCount ?? 0) > 0;
  }

  async deleteUserVariableByKey(userId: string, key: string): Promise<boolean> {
    const result = await db
      .delete(userVariables)
      .where(and(eq(userVariables.userId, userId), eq(userVariables.key, key)));

    return (result.rowCount ?? 0) > 0;
  }
}
