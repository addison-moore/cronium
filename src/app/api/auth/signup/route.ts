import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import bcrypt from "bcrypt";
import { z } from "zod";
import { nanoid } from "nanoid";
import { storage } from "@/server/storage";
import { UserRole } from "@/shared/schema";

// Validation schema for signup request
const signupSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters long"),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate request body
    const result = signupSchema.safeParse(body);
    if (!result.success) {
      const { fieldErrors: errors } = result.error.flatten();
      return NextResponse.json(
        {
          message: "Validation failed",
          errors,
        },
        { status: 400 },
      );
    }

    const { email, password, firstName, lastName } = result.data;

    // Check if user with email already exists
    const existingUser = await storage.getUserByEmail(email);
    if (existingUser) {
      return NextResponse.json(
        {
          message: "Email already in use",
          errors: { email: ["This email is already registered"] },
        },
        { status: 400 },
      );
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Generate a unique ID for the user
    const userId = nanoid();

    // Create user
    await storage.upsertUser({
      id: userId,
      email,
      password: hashedPassword,
      firstName,
      lastName,
      role: UserRole.USER,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return NextResponse.json(
      {
        message: "User created successfully",
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Error creating user:", error);

    // Provide more detailed error message for debugging
    const errorMessage =
      error instanceof Error ? error.message : JSON.stringify(error);

    return NextResponse.json(
      {
        message: "Something went wrong. Please try again.",
        error: errorMessage,
      },
      { status: 500 },
    );
  }
}
