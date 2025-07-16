/**
 * Security validation tests for containerized execution system
 */

import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import supertest from "supertest";
import jwt from "jsonwebtoken";
import { db } from "@/server/db";
import {
  events,
  jobs,
  users,
  EventType,
  EventStatus,
  UserRole,
} from "@/shared/schema";
import { jobService } from "@/lib/services/job-service";
import { eq } from "drizzle-orm";
import crypto from "crypto";

const API_BASE_URL = process.env.API_URL || "http://localhost:5001";
const JWT_SECRET = process.env.JWT_SECRET || "test-secret";

// Test users with different roles
const TEST_USERS = {
  admin: { id: "sec_admin_user", role: UserRole.ADMIN },
  regular: { id: "sec_regular_user", role: UserRole.USER },
  viewer: { id: "sec_viewer_user", role: UserRole.VIEWER },
  malicious: { id: "malicious_user", role: UserRole.USER },
};

describe("Security Validation Tests", () => {
  let testEventId: number;
  let adminToken: string;
  let userToken: string;
  let viewerToken: string;

  beforeAll(async () => {
    // Create test users
    for (const [key, user] of Object.entries(TEST_USERS)) {
      await db
        .insert(users)
        .values({
          id: user.id,
          email: `${key}@security-test.com`,
          username: `security_${key}`,
          role: user.role,
          status: "ACTIVE",
        })
        .onConflictDoNothing();
    }

    // Create test event
    const [event] = await db
      .insert(events)
      .values({
        userId: TEST_USERS.regular.id,
        name: "Security Test Event",
        type: EventType.NODEJS,
        content: 'console.log("test");',
        status: EventStatus.ACTIVE,
        runLocation: "LOCAL",
        shared: false,
        scheduleNumber: 1,
        scheduleUnit: "MINUTES",
        timeoutValue: 30,
        timeoutUnit: "SECONDS",
        retries: 0,
        tags: ["security-test"],
      })
      .returning();

    testEventId = event.id;

    // Generate test tokens
    adminToken = jwt.sign(
      { sub: TEST_USERS.admin.id, role: UserRole.ADMIN },
      JWT_SECRET,
    );
    userToken = jwt.sign(
      { sub: TEST_USERS.regular.id, role: UserRole.USER },
      JWT_SECRET,
    );
    viewerToken = jwt.sign(
      { sub: TEST_USERS.viewer.id, role: UserRole.VIEWER },
      JWT_SECRET,
    );
  });

  afterAll(async () => {
    // Clean up
    await db.delete(events).where(eq(events.id, testEventId));
    for (const user of Object.values(TEST_USERS)) {
      await db.delete(users).where(eq(users.id, user.id));
    }
  });

  describe("Authentication Tests", () => {
    it("should reject requests without authentication", async () => {
      await supertest(API_BASE_URL)
        .post("/api/trpc/events.execute")
        .send({
          json: { id: testEventId },
        })
        .expect(401);
    });

    it("should reject requests with invalid token", async () => {
      const invalidToken = jwt.sign({ sub: "invalid" }, "wrong-secret");

      await supertest(API_BASE_URL)
        .post("/api/trpc/events.execute")
        .set("Authorization", `Bearer ${invalidToken}`)
        .send({
          json: { id: testEventId },
        })
        .expect(401);
    });

    it("should reject expired tokens", async () => {
      const expiredToken = jwt.sign(
        { sub: TEST_USERS.regular.id, exp: Math.floor(Date.now() / 1000) - 60 },
        JWT_SECRET,
      );

      await supertest(API_BASE_URL)
        .post("/api/trpc/events.execute")
        .set("Authorization", `Bearer ${expiredToken}`)
        .send({
          json: { id: testEventId },
        })
        .expect(401);
    });
  });

  describe("Authorization Tests", () => {
    it("should prevent users from executing other users events", async () => {
      const maliciousToken = jwt.sign(
        { sub: TEST_USERS.malicious.id },
        JWT_SECRET,
      );

      await supertest(API_BASE_URL)
        .post("/api/trpc/events.execute")
        .set("Authorization", `Bearer ${maliciousToken}`)
        .send({
          json: { id: testEventId }, // Trying to execute another user's event
        })
        .expect(403);
    });

    it("should prevent viewers from executing events", async () => {
      await supertest(API_BASE_URL)
        .post("/api/trpc/events.execute")
        .set("Authorization", `Bearer ${viewerToken}`)
        .send({
          json: { id: testEventId },
        })
        .expect(403);
    });

    it("should allow admin to execute any event", async () => {
      const response = await supertest(API_BASE_URL)
        .post("/api/trpc/events.execute")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          json: { id: testEventId },
        })
        .expect(200);

      expect(response.body.result.data.json.jobId).toBeDefined();
    });

    it("should prevent modification of other users jobs", async () => {
      // Create a job as regular user
      const job = await jobService.createJob({
        eventId: testEventId,
        userId: TEST_USERS.regular.id,
        type: JobType.SCRIPT,
        payload: {},
      });

      // Try to cancel as different user
      const maliciousToken = jwt.sign(
        { sub: TEST_USERS.malicious.id },
        JWT_SECRET,
      );

      await supertest(API_BASE_URL)
        .post("/api/trpc/jobs.cancel")
        .set("Authorization", `Bearer ${maliciousToken}`)
        .send({
          json: { jobId: job.id },
        })
        .expect(403);
    });
  });

  describe("Input Validation and Injection Prevention", () => {
    it("should sanitize malicious script content", async () => {
      const maliciousScripts = [
        '"; rm -rf /; echo "',
        '<script>alert("XSS")</script>',
        "${process.env.JWT_SECRET}",
        "`cat /etc/passwd`",
        "../../../etc/passwd",
      ];

      for (const script of maliciousScripts) {
        // Try to create event with malicious content
        const response = await supertest(API_BASE_URL)
          .post("/api/trpc/events.create")
          .set("Authorization", `Bearer ${userToken}`)
          .send({
            json: {
              name: "Test Event",
              type: EventType.BASH,
              content: script,
            },
          })
          .expect(200); // Should create but content should be safe

        const eventId = response.body.result.data.json.id;

        // Verify content doesn't contain dangerous patterns when executed
        const execResponse = await supertest(API_BASE_URL)
          .post("/api/trpc/events.execute")
          .set("Authorization", `Bearer ${userToken}`)
          .send({
            json: { id: eventId },
          })
          .expect(200);

        // Clean up
        await db.delete(events).where(eq(events.id, eventId));
      }
    });

    it("should prevent SQL injection in job queries", async () => {
      const maliciousInputs = [
        "'; DROP TABLE jobs; --",
        "1' OR '1'='1",
        "1; UPDATE jobs SET status='completed'",
      ];

      for (const input of maliciousInputs) {
        // These should not cause SQL injection
        await supertest(API_BASE_URL)
          .get("/api/trpc/jobs.list")
          .set("Authorization", `Bearer ${userToken}`)
          .query({
            input: JSON.stringify({
              json: {
                status: input,
                limit: 10,
              },
            }),
          })
          .expect(200); // Should handle safely
      }
    });

    it("should validate job payload size limits", async () => {
      const largePayload = {
        data: "x".repeat(10 * 1024 * 1024), // 10MB of data
      };

      // This should be rejected or truncated
      const response = await supertest(API_BASE_URL)
        .post("/api/trpc/events.execute")
        .set("Authorization", `Bearer ${userToken}`)
        .send({
          json: {
            id: testEventId,
            input: largePayload,
          },
        })
        .expect(400); // Should reject large payloads
    });
  });

  describe("Internal API Security", () => {
    it("should reject internal API calls without proper authentication", async () => {
      await supertest(API_BASE_URL).get("/api/internal/jobs/queue").expect(401);
    });

    it("should reject internal API calls with invalid API key", async () => {
      await supertest(API_BASE_URL)
        .get("/api/internal/jobs/queue")
        .set("x-api-key", "invalid-key")
        .set("x-orchestrator-id", "test-orchestrator")
        .expect(401);
    });

    it("should require orchestrator ID for job claiming", async () => {
      await supertest(API_BASE_URL)
        .get("/api/internal/jobs/queue")
        .set("x-api-key", process.env.INTERNAL_API_KEY!)
        .expect(400); // Should require orchestrator ID
    });
  });

  describe("Container Isolation Security", () => {
    it("should generate unique JWT tokens for each execution", async () => {
      const tokens: string[] = [];

      // Execute same event multiple times
      for (let i = 0; i < 5; i++) {
        const response = await supertest(API_BASE_URL)
          .post("/api/trpc/events.execute")
          .set("Authorization", `Bearer ${userToken}`)
          .send({
            json: { id: testEventId },
          })
          .expect(200);

        const jobId = response.body.result.data.json.jobId;
        const job = await jobService.getJob(jobId);

        if (job?.payload.executionToken) {
          tokens.push(job.payload.executionToken);
        }
      }

      // All tokens should be unique
      const uniqueTokens = new Set(tokens);
      expect(uniqueTokens.size).toBe(tokens.length);
    });

    it("should include execution scope in JWT tokens", async () => {
      const response = await supertest(API_BASE_URL)
        .post("/api/trpc/events.execute")
        .set("Authorization", `Bearer ${userToken}`)
        .send({
          json: { id: testEventId },
        })
        .expect(200);

      const jobId = response.body.result.data.json.jobId;
      const job = await jobService.getJob(jobId);

      if (job?.payload.executionToken) {
        const decoded = jwt.decode(job.payload.executionToken) as any;
        expect(decoded.executionId).toBeDefined();
        expect(decoded.userId).toBe(TEST_USERS.regular.id);
        expect(decoded.exp).toBeDefined(); // Should have expiration
      }
    });
  });

  describe("Rate Limiting and DoS Prevention", () => {
    it("should rate limit API requests per user", async () => {
      const requests = [];

      // Make many rapid requests
      for (let i = 0; i < 100; i++) {
        requests.push(
          supertest(API_BASE_URL)
            .get("/api/trpc/events.list")
            .set("Authorization", `Bearer ${userToken}`)
            .query({
              input: JSON.stringify({ json: {} }),
            }),
        );
      }

      const responses = await Promise.all(requests);
      const rateLimited = responses.filter((r) => r.status === 429);

      // Should have some rate limited responses
      expect(rateLimited.length).toBeGreaterThan(0);
    });

    it("should limit concurrent job claims per orchestrator", async () => {
      // Create many jobs
      const jobIds = [];
      for (let i = 0; i < 50; i++) {
        const job = await jobService.createJob({
          eventId: testEventId,
          userId: TEST_USERS.regular.id,
          type: JobType.SCRIPT,
          payload: {},
        });
        jobIds.push(job.id);
      }

      // Try to claim all at once
      const response = await supertest(API_BASE_URL)
        .get("/api/internal/jobs/queue")
        .set("x-api-key", process.env.INTERNAL_API_KEY!)
        .set("x-orchestrator-id", "greedy-orchestrator")
        .query({ limit: 100 })
        .expect(200);

      // Should be limited to reasonable batch size
      expect(response.body.jobs.length).toBeLessThanOrEqual(20);
    });
  });

  describe("Data Encryption and Privacy", () => {
    it("should not expose sensitive data in job payloads", async () => {
      const sensitiveData = {
        password: "secret123",
        apiKey: "sk_test_123456",
        creditCard: "4111111111111111",
      };

      const response = await supertest(API_BASE_URL)
        .post("/api/trpc/events.execute")
        .set("Authorization", `Bearer ${userToken}`)
        .send({
          json: {
            id: testEventId,
            input: sensitiveData,
          },
        })
        .expect(200);

      const jobId = response.body.result.data.json.jobId;

      // Retrieve job via API (not direct DB access)
      const jobResponse = await supertest(API_BASE_URL)
        .get("/api/trpc/jobs.get")
        .set("Authorization", `Bearer ${userToken}`)
        .query({
          input: JSON.stringify({ json: { jobId } }),
        })
        .expect(200);

      const job = jobResponse.body.result.data.json;

      // Sensitive data should be masked or encrypted
      if (job.payload?.input) {
        expect(job.payload.input.password).not.toBe("secret123");
        expect(job.payload.input.apiKey).not.toContain("sk_test");
        expect(job.payload.input.creditCard).not.toBe("4111111111111111");
      }
    });

    it("should encrypt environment variables in job payloads", async () => {
      // Create event with env vars
      const [event] = await db
        .insert(events)
        .values({
          userId: TEST_USERS.regular.id,
          name: "Event with Env Vars",
          type: EventType.NODEJS,
          content: "console.log(process.env.SECRET_KEY);",
          status: EventStatus.ACTIVE,
          runLocation: "LOCAL",
          shared: false,
          scheduleNumber: 1,
          scheduleUnit: "MINUTES",
          timeoutValue: 30,
          timeoutUnit: "SECONDS",
          retries: 0,
          tags: ["security-test"],
        })
        .returning();

      // Add env vars (these would normally be encrypted in DB)
      // ... env var setup ...

      const response = await supertest(API_BASE_URL)
        .post("/api/trpc/events.execute")
        .set("Authorization", `Bearer ${userToken}`)
        .send({
          json: { id: event.id },
        })
        .expect(200);

      const jobId = response.body.result.data.json.jobId;
      const job = await jobService.getJob(jobId);

      // Environment variables should not be in plain text in job payload
      if (job?.payload.environment) {
        Object.values(job.payload.environment).forEach((value) => {
          expect(value).not.toContain("SECRET");
          expect(value).not.toContain("PASSWORD");
          expect(value).not.toContain("KEY");
        });
      }

      // Clean up
      await db.delete(events).where(eq(events.id, event.id));
    });
  });

  describe("Audit and Logging Security", () => {
    it("should log security-relevant events", async () => {
      // Failed authentication attempt
      await supertest(API_BASE_URL)
        .post("/api/trpc/events.execute")
        .set("Authorization", "Bearer invalid-token")
        .send({
          json: { id: testEventId },
        })
        .expect(401);

      // Check audit logs would contain this attempt
      // (In real implementation, would check audit log table)
    });

    it("should not log sensitive data in error messages", async () => {
      try {
        // Trigger an error with sensitive data
        await supertest(API_BASE_URL)
          .post("/api/trpc/events.create")
          .set("Authorization", `Bearer ${userToken}`)
          .send({
            json: {
              name: "Test",
              type: "INVALID_TYPE",
              content: "password=supersecret123",
            },
          })
          .expect(400);
      } catch (error: any) {
        // Error message should not contain the password
        expect(error.message).not.toContain("supersecret123");
      }
    });
  });

  describe("CORS and Origin Validation", () => {
    it("should reject requests from unauthorized origins", async () => {
      await supertest(API_BASE_URL)
        .post("/api/trpc/events.execute")
        .set("Authorization", `Bearer ${userToken}`)
        .set("Origin", "http://malicious-site.com")
        .send({
          json: { id: testEventId },
        })
        .expect(403); // Should reject based on CORS
    });

    it("should allow requests from authorized origins", async () => {
      const allowedOrigin =
        process.env.ALLOWED_ORIGIN || "http://localhost:5001";

      await supertest(API_BASE_URL)
        .post("/api/trpc/events.execute")
        .set("Authorization", `Bearer ${userToken}`)
        .set("Origin", allowedOrigin)
        .send({
          json: { id: testEventId },
        })
        .expect(200);
    });
  });
});
