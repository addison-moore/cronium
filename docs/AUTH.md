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

- Each user has a `role` — `ADMIN`, `USER`, or `VIEWER` — stored in the database.
- Role behavior is enforced centrally through a deny-by-default capability
  matrix (`src/server/security/authorization.ts`) with capabilities `view`,
  `fork`, `edit`, `execute`, `use-secret`, and `admin`:
  - **Admin** may perform audited platform administration, but has no implicit
    secret-use bypass — resource ownership is still checked at execution and
    secret resolution.
  - **User** may mutate and execute owned resources and use only owned or
    narrowly granted secrets.
  - **Viewer** is read-only: no create, fork, mutate, execute, terminal, or
    secret use, on any transport (tRPC, REST, MCP, sockets, scheduled
    dispatch).
- Every state-changing tRPC route declares its capability in
  `src/server/security/route-capabilities.ts`; a CI test
  (`tests/security/route-capability-inventory.test.ts`) fails when a new
  mutation lacks a declaration.
- Admins can:
  - Enable/disable users
  - Delete users
  - Change roles
  - Revoke all of a user's sessions (`admin.revokeUserSessions`)

### 4a. Sessions and revocation

- Browser sessions are JWT-based with an explicit **8-hour maximum**.
- Users carry a monotonic `sessionVersion`. It is embedded in every session and
  bumped transactionally on password, role, and status changes, so stale
  sessions fail immediately — not at JWT expiry.
- Every sensitive request re-checks the live principal (status/role/version)
  against the database through a short (15 s) shared cache that is invalidated
  in the same security event; if current state cannot be established the
  request **fails closed**.
- API/MCP bearer tokens are checked against the owner's live status on every
  request; password reset (account recovery) also revokes all active API
  tokens. Live sockets and terminals are disconnected via the shared
  revocation channel.

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
