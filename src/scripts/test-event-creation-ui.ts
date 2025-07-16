import { db } from "../server/db";
import { events, jobs } from "../shared/schema";
import { eq, desc } from "drizzle-orm";

async function testEventCreationUI() {
  console.log("🧪 Testing Event Creation UI Integration...\n");

  try {
    // Test 1: Check recent event creation
    console.log("1️⃣ Checking recent events created via UI...");
    const recentEvents = await db
      .select()
      .from(events)
      .orderBy(desc(events.createdAt))
      .limit(5);

    if (recentEvents.length > 0) {
      console.log(`✅ Found ${recentEvents.length} recent events:`);
      recentEvents.forEach((event) => {
        console.log(
          `   - ${event.name} (${event.type}) - Status: ${event.status}`,
        );

        // Verify required fields
        const requiredFields = [
          "name",
          "type",
          "status",
          "triggerType",
          "runLocation",
        ];
        const missingFields = requiredFields.filter(
          (field) => !event[field as keyof typeof event],
        );

        if (missingFields.length > 0) {
          console.log(
            `     ⚠️  Missing required fields: ${missingFields.join(", ")}`,
          );
        } else {
          console.log(`     ✅ All required fields present`);
        }

        // Check script content for script types
        if (["python", "bash", "nodejs"].includes(event.type)) {
          if (!event.content || event.content.trim() === "") {
            console.log(`     ⚠️  Script type but no content`);
          } else {
            console.log(
              `     ✅ Script content present (${event.content.length} chars)`,
            );
          }
        }

        // Check HTTP request fields
        if (event.type === "http_request") {
          if (!event.httpMethod || !event.httpUrl) {
            console.log(`     ⚠️  HTTP request missing method or URL`);
          } else {
            console.log(
              `     ✅ HTTP request configured: ${event.httpMethod} ${event.httpUrl}`,
            );
          }
        }

        // Check environment variables
        if (event.environmentVariables) {
          try {
            const envVars =
              typeof event.environmentVariables === "string"
                ? JSON.parse(event.environmentVariables)
                : event.environmentVariables;
            console.log(
              `     ✅ Environment variables: ${Array.isArray(envVars) ? envVars.length : 0} vars`,
            );
          } catch (e) {
            console.log(`     ⚠️  Invalid environment variables format`);
          }
        }

        // Check server selection for remote execution
        if (event.runLocation === "remote") {
          if (
            !event.selectedServerIds ||
            (Array.isArray(event.selectedServerIds) &&
              event.selectedServerIds.length === 0)
          ) {
            console.log(`     ⚠️  Remote execution but no servers selected`);
          } else {
            console.log(`     ✅ Remote execution configured with servers`);
          }
        }
      });
    } else {
      console.log(
        "⚠️  No events found. Please create an event through the UI first.",
      );
    }

    // Test 2: Check if event creation triggers job creation
    console.log("\n2️⃣ Checking if manual event execution creates jobs...");

    // Get the most recent event
    const [mostRecentEvent] = recentEvents;
    if (mostRecentEvent) {
      // Check for jobs created from this event
      const relatedJobs = await db
        .select()
        .from(jobs)
        .where(eq(jobs.eventId, mostRecentEvent.id))
        .orderBy(desc(jobs.createdAt))
        .limit(5);

      if (relatedJobs.length > 0) {
        console.log(
          `✅ Found ${relatedJobs.length} jobs for event "${mostRecentEvent.name}":`,
        );
        relatedJobs.forEach((job) => {
          console.log(`   - Job ${job.id}: ${job.status} (${job.type})`);

          // Verify job payload
          if (job.payload) {
            try {
              const payload =
                typeof job.payload === "string"
                  ? JSON.parse(job.payload)
                  : job.payload;
              console.log(`     ✅ Payload structure valid`);

              // Check payload contents based on event type
              if (mostRecentEvent.type === "python" && !payload.script) {
                console.log(`     ⚠️  Python event but no script in payload`);
              }
              if (
                mostRecentEvent.type === "http_request" &&
                !payload.httpRequest
              ) {
                console.log(
                  `     ⚠️  HTTP request event but no httpRequest in payload`,
                );
              }
            } catch (e) {
              console.log(`     ⚠️  Invalid job payload format`);
            }
          }
        });
      } else {
        console.log(
          `⚠️  No jobs found for event "${mostRecentEvent.name}". Try running the event.`,
        );
      }
    }

    // Test 3: Validate form data structure
    console.log("\n3️⃣ Validating event data structure...");

    const eventValidationResults = recentEvents.map((event) => {
      const issues: string[] = [];

      // Check timeout values
      if (!event.timeoutValue || event.timeoutValue < 1) {
        issues.push("Invalid timeout value");
      }

      // Check schedule configuration for scheduled events
      if (event.triggerType === "schedule") {
        if (
          !event.customSchedule &&
          (!event.scheduleNumber || !event.scheduleUnit)
        ) {
          issues.push("Scheduled event missing schedule configuration");
        }
      }

      // Check conditional actions if present
      if (event.conditionalEvents) {
        try {
          const conditionalEvents = JSON.parse(
            event.conditionalEvents as string,
          );
          if (!Array.isArray(conditionalEvents)) {
            issues.push("Conditional events not an array");
          }
        } catch {
          issues.push("Invalid conditional events format");
        }
      }

      return {
        name: event.name,
        valid: issues.length === 0,
        issues,
      };
    });

    console.log("Event validation results:");
    eventValidationResults.forEach((result) => {
      if (result.valid) {
        console.log(`   ✅ ${result.name} - Valid`);
      } else {
        console.log(
          `   ⚠️  ${result.name} - Issues: ${result.issues.join(", ")}`,
        );
      }
    });

    // Summary
    console.log("\n📊 Summary:");
    console.log(`   - Total recent events: ${recentEvents.length}`);
    console.log(
      `   - Valid events: ${eventValidationResults.filter((r) => r.valid).length}`,
    );
    console.log(
      `   - Events with issues: ${eventValidationResults.filter((r) => !r.valid).length}`,
    );

    if (mostRecentEvent && relatedJobs.length > 0) {
      console.log("   - ✅ Event → Job creation working");
    } else {
      console.log("   - ⚠️  Event → Job creation needs testing");
    }
  } catch (error) {
    console.error("❌ Error during testing:", error);
  }
}

// Run the test
testEventCreationUI().catch(console.error);
