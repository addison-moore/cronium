import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/server/db";
import { UserRole, LogStatus } from "@/shared/schema";
import { logs } from "@/shared/schema";
import { and, count, desc, eq } from "drizzle-orm";
import { z } from "zod";

// Validation schema for query parameters
const LogsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().default(20),
  eventId: z.coerce.number().int().positive().optional(),
  userId: z.string().optional(),
  status: z.nativeEnum(LogStatus).optional(),
});

export async function GET(req: NextRequest) {
  try {
    // Check if the user is authenticated and is an admin
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    if (session.user.role !== UserRole.ADMIN) {
      return NextResponse.json(
        { message: "Forbidden: Admin access required" },
        { status: 403 },
      );
    }

    // Parse and validate query parameters
    const url = new URL(req.url);
    const queryParams = Object.fromEntries(url.searchParams.entries());

    const { page, limit, eventId, userId, status } =
      LogsQuerySchema.parse(queryParams);

    // Build filters
    const filters = [];
    if (eventId) filters.push(eq(logs.eventId, eventId));
    if (userId) filters.push(eq(logs.userId, userId));
    if (status) filters.push(eq(logs.status, status));

    // Calculate pagination
    const offset = (page - 1) * limit;

    // Get total count with filters
    const totalCountResult = await db
      .select({ value: count() })
      .from(logs)
      .where(filters.length ? and(...filters) : undefined);
    const totalCount = totalCountResult[0]?.value ?? 0;

    // Fetch logs with pagination
    const logsData = await db
      .select()
      .from(logs)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(logs.startTime))
      .limit(limit)
      .offset(offset);

    // Calculate pagination metadata
    const totalPages = Math.ceil(totalCount / limit);

    return NextResponse.json({
      logs: logsData,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    });
  } catch (error) {
    console.error("Error fetching logs:", error);
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { message: "Invalid query parameters", errors: error.errors },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { message: "An error occurred while fetching logs" },
      { status: 500 },
    );
  }
}
