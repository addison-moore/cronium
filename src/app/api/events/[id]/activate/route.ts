import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { storage } from "@/server/storage";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { EventStatus } from "@/shared/schema";
import { scheduler } from "@/lib/scheduler";

/**
 * Special endpoint to properly handle event activation with counter reset
 * This ensures that the "resetCounterOnActive" flag is properly implemented
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // Properly await params to avoid Next.js warning
  const { id } = await params;
  console.log("Event activation request received for event ID:", id);

  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return new NextResponse(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const userId = session.user.id;
    const eventId = parseInt(id, 10);

    if (isNaN(eventId)) {
      return new NextResponse(JSON.stringify({ error: "Invalid event ID" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Check if the event exists and belongs to this user
    const existingEvent = await storage.getEvent(eventId);

    if (!existingEvent) {
      return new NextResponse(JSON.stringify({ error: "Event not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (existingEvent.userId !== userId) {
      return new NextResponse(JSON.stringify({ error: "Unauthorized" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Check if the event is already active
    if (existingEvent.status === EventStatus.ACTIVE) {
      return NextResponse.json({
        message: "Event is already active",
        event: existingEvent,
      });
    }

    // Prepare the updates object
    const updates: any = {
      status: EventStatus.ACTIVE,
    };

    // If resetCounterOnActive is true, reset the execution counter to zero
    if (existingEvent.resetCounterOnActive) {
      console.log(
        `Resetting execution counter for event ${eventId} before activation`,
      );
      updates.executionCount = 0;
    } else {
      console.log(
        `Not resetting counter for event ${eventId} (resetCounterOnActive is ${existingEvent.resetCounterOnActive})`,
      );
    }

    // Update the event with the new status and potentially reset counter
    const updatedEvent = await storage.updateScript(eventId, updates);

    // Notify the scheduler to start this event
    await scheduler.scheduleScript(updatedEvent);

    return NextResponse.json({
      message: "Event activated successfully",
      event: updatedEvent,
      counterReset: existingEvent.resetCounterOnActive,
    });
  } catch (error) {
    console.error("Error activating event:", error);
    return new NextResponse(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}

/**
 * Special endpoint to pause an event properly
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // Properly await params to avoid Next.js warning
  const { id } = await params;

  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return new NextResponse(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const userId = session.user.id;
    const eventId = parseInt(id, 10);

    if (isNaN(eventId)) {
      return new NextResponse(JSON.stringify({ error: "Invalid event ID" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Check if the event exists and belongs to this user
    const existingEvent = await storage.getEvent(eventId);

    if (!existingEvent) {
      return new NextResponse(JSON.stringify({ error: "Event not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (existingEvent.userId !== userId) {
      return new NextResponse(JSON.stringify({ error: "Unauthorized" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Check if the event is already paused
    if (existingEvent.status !== EventStatus.ACTIVE) {
      return NextResponse.json({
        message: "Event is already paused",
        event: existingEvent,
      });
    }

    // Update the event status to PAUSED
    const updatedEvent = await storage.updateScript(eventId, {
      status: EventStatus.PAUSED,
    });

    // Remove the event from scheduler
    scheduler.deleteScript(eventId);

    return NextResponse.json({
      message: "Event paused successfully",
      event: updatedEvent,
    });
  } catch (error) {
    console.error("Error pausing event:", error);
    return new NextResponse(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}
