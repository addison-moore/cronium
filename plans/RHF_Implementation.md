# React Hook Form Implementation Plan

## Introduction

This document outlines the plan to update all forms in the Cronium application to use React Hook Form (RHF) following the best practices outlined in the `docs/RHF_GUIDE.md` document. The goal is to improve form performance, maintainability, and user experience.

## Phase 1: Refactor Legacy Auth Forms

This phase focuses on refactoring the authentication forms, which are critical for user interaction and currently use `useState` for form management.

### Checklist

- [ ] **`src/app/[lang]/auth/forgot-password/page.tsx`**
  - [ ] Replace `useState` with `useForm` from React Hook Form.
  - [ ] Implement Zod schema for validation.
  - [ ] Use the `zodResolver` with `useForm`.
  - [ ] Refactor the form to use the `register` method for inputs.
  - [ ] Use `formState.errors` to display validation messages.
  - [ ] Write unit tests for the form, covering validation and submission.
  - [ ] Manually test the form to ensure proper functionality.

- [ ] **`src/app/[lang]/auth/reset-password/page.tsx`**
  - [ ] Replace `useState` with `useForm` from React Hook Form.
  - [ ] Implement Zod schema for validation.
  - [ ] Use the `zodResolver` with `useForm`.
  - [ ] Refactor the form to use the `register` method for inputs.
  - [ ] Use `formState.errors` to display validation messages.
  - [ ] Write unit tests for the form, covering validation and submission.
  - [ ] Manually test the form to ensure proper functionality.

- [ ] **`src/app/[lang]/auth/signin/page.tsx`**
  - [ ] Replace `useState` with `useForm` from React Hook Form.
  - [ ] Implement Zod schema for validation.
  - [ ] Use the `zodResolver` with `useForm`.
  - [ ] Refactor the form to use the `register` method for inputs.
  - [ ] Use `formState.errors` to display validation messages.
  - [ ] Write unit tests for the form, covering validation and submission.
  - [ ] Manually test the form to ensure proper functionality.

- [ ] **`src/app/[lang]/auth/signup/page.tsx`** (Uses SignUpForm component - see Phase 3)
  - [ ] Component already migrated to RHF - see `src/components/auth/SignUpForm.tsx` in Phase 3

## Phase 2: Refactor Other Legacy Forms

This phase focuses on refactoring other forms in the application that are currently using `useState` or simple `onSubmit` handlers.

### Checklist

- [ ] **`src/components/dashboard/ApiTokensManager.tsx`**
  - [ ] Replace the simple `onSubmit` handler with `useForm` from React Hook Form.
  - [ ] Implement Zod schema for validation.
  - [ ] Use the `zodResolver` with `useForm`.
  - [ ] Refactor the form to use the `register` method for inputs.
  - [ ] Write unit tests for the form, covering validation and submission.
  - [ ] Manually test the form to ensure proper functionality.

- [ ] **`src/components/event-form/EventForm.tsx`**
  - [ ] Replace the simple `onSubmit` handler with `useForm` from React Hook Form.
  - [ ] Implement Zod schema for validation.
  - [ ] Use the `zodResolver` with `useForm`.
  - [ ] Refactor the form to use the `register` method for inputs.
  - [ ] Write unit tests for the form, covering validation and submission.
  - [ ] Manually test the form to ensure proper functionality.

- [ ] **`src/components/tools/modular-tools-manager.tsx`**
  - [ ] Replace the simple `onSubmit` handler with `useForm` from React Hook Form.
  - [ ] Implement Zod schema for validation.
  - [ ] Use the `zodResolver` with `useForm`.
  - [ ] Refactor the form to use the `register` method for inputs.
  - [ ] Write unit tests for the form, covering validation and submission.
  - [ ] Manually test the form to ensure proper functionality.

- [ ] **`src/components/workflows/WorkflowDetailsForm.tsx`**
  - [ ] Replace `useState` with `useForm` from React Hook Form.
  - [ ] Implement Zod schema for validation.
  - [ ] Use the `zodResolver` with `useForm`.
  - [ ] Refactor the form to use the `register` method for inputs.
  - [ ] Write unit tests for the form, covering validation and submission.
  - [ ] Manually test the form to ensure proper functionality.

- [ ] **`src/components/dashboard/HttpRequestForm.tsx`**
  - [ ] Replace prop drilling with `useForm` from React Hook Form.
  - [ ] Implement Zod schema for validation.
  - [ ] Use the `zodResolver` with `useForm`.
  - [ ] Refactor the form to use the `register` method for inputs.
  - [ ] Use `Controller` for dynamic header fields.
  - [ ] Write unit tests for the form, covering validation and submission.
  - [ ] Manually test the form to ensure proper functionality.

- [ ] **`src/app/[lang]/auth/activate/page.tsx`**
  - [ ] Investigate if this page contains a form.
  - [ ] If yes, replace any `useState` with `useForm` from React Hook Form.
  - [ ] Implement Zod schema for validation if applicable.
  - [ ] Use the `zodResolver` with `useForm`.
  - [ ] Refactor the form to use the `register` method for inputs.
  - [ ] Write unit tests for the form, covering validation and submission.
  - [ ] Manually test the form to ensure proper functionality.

## Phase 3: Review and Refactor Existing RHF Forms

This phase focuses on reviewing and refactoring the forms that are already using React Hook Form to ensure they align with the best practices outlined in the `docs/RHF_GUIDE.md` document.

### Checklist

- [ ] **`src/app/[lang]/dashboard/settings/page.tsx`**
  - [ ] Review the existing RHF implementation.
  - [ ] Ensure a Zod schema is used for validation and connected with `zodResolver`.
  - [ ] Use the `<Controller>` component for any third-party UI components.
  - [ ] Optimize re-renders with `useWatch` or `useFormState` if necessary.
  - [ ] Write unit tests for the form, covering validation and submission.
  - [ ] Manually test the form to ensure proper functionality.

- [ ] **`src/components/admin/ai-settings.tsx`**
  - [ ] Review the existing RHF implementation.
  - [ ] Ensure a Zod schema is used for validation and connected with `zodResolver`.
  - [ ] Write unit tests for the form, covering validation and submission.
  - [ ] Manually test the form to ensure proper functionality.

- [ ] **`src/components/admin/registration-settings.tsx`**
  - [ ] Review the existing RHF implementation.
  - [ ] Ensure a Zod schema is used for validation and connected with `zodResolver`.
  - [ ] Write unit tests for the form, covering validation and submission.
  - [ ] Manually test the form to ensure proper functionality.

- [ ] **`src/components/admin/smtp-settings.tsx`**
  - [ ] Review the existing RHF implementation.
  - [ ] Ensure a Zod schema is used for validation and connected with `zodResolver`.
  - [ ] Write unit tests for the form, covering validation and submission.
  - [ ] Manually test the form to ensure proper functionality.

- [ ] **`src/components/admin/users-management.tsx`**
  - [ ] Review the existing RHF implementation.
  - [ ] Ensure a Zod schema is used for validation and connected with `zodResolver`.
  - [ ] Write unit tests for the form, covering validation and submission.
  - [ ] Manually test the form to ensure proper functionality.

- [ ] **`src/components/dashboard/ServerForm.tsx`**
  - [ ] Review the existing RHF implementation.
  - [ ] Ensure a Zod schema is used for validation and connected with `zodResolver`.
  - [ ] Write unit tests for the form, covering validation and submission.
  - [ ] Manually test the form to ensure proper functionality.

- [ ] **`src/components/tools/plugins/discord/discord-plugin.tsx`**
  - [ ] Review the existing RHF implementation.
  - [ ] Ensure a Zod schema is used for validation and connected with `zodResolver`.
  - [ ] Write unit tests for the form, covering validation and submission.
  - [ ] Manually test the form to ensure proper functionality.

- [ ] **`src/components/tools/plugins/email/email-plugin.tsx`**
  - [ ] Review the existing RHF implementation.
  - [ ] Ensure a Zod schema is used for validation and connected with `zodResolver`.
  - [ ] Write unit tests for the form, covering validation and submission.
  - [ ] Manually test the form to ensure proper functionality.

- [ ] **`src/components/tools/plugins/slack/slack-plugin.tsx`**
  - [ ] Review the existing RHF implementation.
  - [ ] Ensure a Zod schema is used for validation and connected with `zodResolver`.
  - [ ] Write unit tests for the form, covering validation and submission.
  - [ ] Manually test the form to ensure proper functionality.

- [ ] **`src/components/tools/template-form.tsx`**
  - [ ] Review the existing RHF implementation.
  - [ ] Ensure a Zod schema is used for validation and connected with `zodResolver`.
  - [ ] Write unit tests for the form, covering validation and submission.
  - [ ] Manually test the form to ensure proper functionality.

- [ ] **`src/components/webhooks/WebhookForm.tsx`**
  - [ ] Review the existing RHF implementation.
  - [ ] Ensure a Zod schema is used for validation and connected with `zodResolver`.
  - [ ] Write unit tests for the form, covering validation and submission.
  - [ ] Manually test the form to ensure proper functionality.

- [ ] **`src/components/webhooks/WebhookSecurityForm.tsx`**
  - [ ] Review the existing RHF implementation.
  - [ ] Ensure a Zod schema is used for validation and connected with `zodResolver`.
  - [ ] Write unit tests for the form, covering validation and submission.
  - [ ] Manually test the form to ensure proper functionality.

- [ ] **`src/components/workflows/WorkflowForm.tsx`**
  - [ ] Review the existing RHF implementation.
  - [ ] Ensure a Zod schema is used for validation and connected with `zodResolver`.
  - [ ] Write unit tests for the form, covering validation and submission.
  - [ ] Manually test the form to ensure proper functionality.

- [ ] **`src/components/auth/SignUpForm.tsx`**
  - [ ] Review the existing RHF implementation.
  - [ ] Ensure proper error handling for server errors.
  - [ ] Review accessibility of form elements.
  - [ ] Write unit tests for the form, covering validation and submission.
  - [ ] Manually test the form to ensure proper functionality.

## Phase 4: Documentation and Best Practices

- [ ] Update the `docs/RHF_GUIDE.md` with:
  - [ ] Error handling best practices section
  - [ ] Testing examples for RHF forms
  - [ ] More TypeScript patterns with Zod
  - [ ] Accessibility guidelines
  - [ ] Custom hook patterns for reusable forms

- [ ] Create a migration checklist template for developers
- [ ] Document common pitfalls and solutions
- [ ] Add examples of complex form patterns (conditional fields, dynamic arrays, etc.)
