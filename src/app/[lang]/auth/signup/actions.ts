"use server";

import { hash } from "bcrypt";
import { nanoid } from "nanoid";
import { UserRole, UserStatus } from "@/shared/schema";
import { storage } from "@/server/storage";

type RegisterFormData = {
  username: string;
  email: string;
  password: string;
};

export async function registerUser(formData: RegisterFormData) {
  try {
    // Hash the password securely
    const hashedPassword = await hash(formData.password, 12);
    
    // Check if username already exists
    const existingUsername = await storage.getUserByUsername(formData.username);
    if (existingUsername) {
      return { success: false, error: "Username already taken" };
    }
    
    // Check if email already exists
    const existingEmail = await storage.getUserByEmail(formData.email);
    if (existingEmail) {
      return { success: false, error: "Email already registered" };
    }
    
    // Check registration settings and determine user status
    const allowRegistrationSetting = await storage.getSetting("allowRegistration");
    const requireAdminApprovalSetting = await storage.getSetting("requireAdminApproval");
    const inviteOnlySetting = await storage.getSetting("inviteOnly");
    
    const allowRegistration = allowRegistrationSetting?.value !== "false";
    const requireAdminApproval = requireAdminApprovalSetting?.value === "true";
    const inviteOnly = inviteOnlySetting?.value === "true";
    
    // Check if registration is allowed
    if (inviteOnly || !allowRegistration) {
      return { success: false, error: "Registration is currently closed" };
    }
    
    // Determine user status based on admin approval requirement
    const userStatus = requireAdminApproval ? UserStatus.PENDING : UserStatus.ACTIVE;
    
    // Create user directly in storage (password is already hashed)
    const userId = nanoid();
    const userData = {
      id: userId,
      username: formData.username,
      email: formData.email,
      password: hashedPassword,
      role: UserRole.USER,
      status: userStatus,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    
    await storage.createUser({ ...userData, skipPasswordHashing: true });

    const successMessage = requireAdminApproval 
      ? "Registration successful! Your account is pending admin approval."
      : "Registration successful! You can now sign in.";

    return { success: true, message: successMessage };
  } catch (error) {
    console.error("Registration error:", error);
    return { 
      success: false, 
      error: "An unexpected error occurred. Please try again." 
    };
  }
}