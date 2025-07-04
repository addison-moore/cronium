# 🔐 Cronium Authentication – Current Implementation

This document outlines the authentication and user management system in Cronium as it currently stands.

---

## ✅ Current Stack

- **Authentication Provider:** [`next-auth`](https://next-auth.js.org/)
- **Email Provider:** Nodemailer (SMTP)
- **Session Management:** Cookie-based (JWT or server session optional)
- **User Management Interface:** Admin Dashboard

---

## 🔐 Authentication Features

### 1. Email Login

- Users authenticate using email + password.
- Session is created via `next-auth`'s credentials provider.

### 2. Password Reset

- Token-based password reset flow implemented using `next-auth` and Nodemailer.
- Tokens are time-limited and stored securely (e.g., in DB or encrypted).

### 3. Invite System

- Admins can invite users by generating a tokenized invitation link.
- Invite flow allows new users to register and set a password via the same link.

### 4. Roles and Permissions

- Each user has a `role` (e.g., `admin`, `user`, `viewer`), stored in the database.
- Role-based access is enforced both in the frontend UI and server APIs.
- Admins can:
  - Enable/disable users
  - Delete users
  - Change roles

### 5. Admin Dashboard

- Lists all users with their status and roles
- Provides controls for:
  - Inviting new users
  - Resetting passwords
  - Editing roles and permissions
  - Deactivating or deleting users

---

## 🔐 Security Considerations

- Passwords are hashed using bcrypt or similar secure hashing algorithms.
- Email tokens for reset/invite are cryptographically random and time-limited.
- Role checks must be enforced at both the UI and backend API level.
- Future enhancement: Add 2FA and session expiration policies

---

## ❌ Deprecated Plans

- Migration to Ory Kratos has been **postponed indefinitely**.
- This means:
  - No changes to the current self-managed authentication logic.
  - No use of Kratos flows, schemas, or external user store.

---

## 🛠 Planned Improvements (with next-auth)

- [ ] Add support for OAuth providers (e.g., GitHub, Google)
- [ ] Audit session security and expiration
- [ ] Enhance logging of login events
- [ ] Add frontend route guards for role-based UI

---

## 🧠 Summary for Developers

- Stick with `next-auth` for all authentication logic
- Use email + password + token-based reset and invites
- Role and permission checks are critical for protecting sensitive features like shell access or server config
- Admins manage users entirely from the built-in dashboard
