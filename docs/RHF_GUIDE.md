# React Hook Form Best Practices Guide

## Introduction

React Hook Form (RHF) is a powerful and performant library for managing forms in React. It leverages a strategy of using uncontrolled components to minimize re-renders and optimize performance. This guide outlines the best practices for using RHF in 2025, with a focus on modern techniques and integrations.

## Core Concepts

### Uncontrolled Components

RHF's performance comes from its use of uncontrolled components. Instead of managing form state with React state, RHF uses a `ref` to register inputs. This means that the component doesn't re-render every time a user types a character.

### `register`

The `register` method is the primary way to connect your inputs to RHF. It's the most performant approach and should be used for standard HTML inputs.

**Example:**

```tsx
import { useForm } from "react-hook-form";

function MyForm() {
  const { register, handleSubmit } = useForm();

  const onSubmit = (data) => console.log(data);

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <input {...register("firstName")} />
      <input {...register("lastName")} />
      <button type="submit">Submit</button>
    </form>
  );
}
```

### `Controller`

When working with third-party UI libraries like Material-UI or Ant Design, you'll often need to use controlled components. In these cases, the `<Controller>` component is the best choice. It wraps the controlled component and isolates re-renders to only that component.

**Example:**

```tsx
import { useForm, Controller } from "react-hook-form";
import { TextField } from "@mui/material";

function MyForm() {
  const { control, handleSubmit } = useForm();

  const onSubmit = (data) => console.log(data);

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <Controller
        name="firstName"
        control={control}
        render={({ field }) => <TextField {...field} />}
      />
      <button type="submit">Submit</button>
    </form>
  );
}
```

## Validation

### Schema-Based Validation with Zod

For robust and reusable validation, it's highly recommended to use a schema validation library. Zod is a TypeScript-first library that provides excellent type inference and is a popular choice for new projects.

To connect Zod with RHF, use the `@hookform/resolvers` package.

**Example:**

```tsx
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

const schema = z.object({
  firstName: z.string().min(2),
  lastName: z.string().min(2),
});

function MyForm() {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(schema),
  });

  const onSubmit = (data) => console.log(data);

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <input {...register("firstName")} />
      {errors.firstName && <p>{errors.firstName.message}</p>}
      <input {...register("lastName")} />
      {errors.lastName && <p>{errors.lastName.message}</p>}
      <button type="submit">Submit</button>
    </form>
  );
}
```

## Performance Optimization

### `useWatch`

To subscribe to changes in specific fields without re-rendering the entire form, use the `useWatch` hook.

**Example:**

```tsx
import { useForm, useWatch } from "react-hook-form";

function MyForm() {
  const { control, register, handleSubmit } = useForm();
  const firstName = useWatch({
    control,
    name: "firstName",
  });

  return (
    <form onSubmit={handleSubmit(console.log)}>
      <input {...register("firstName")} />
      <p>First Name: {firstName}</p>
      <button type="submit">Submit</button>
    </form>
  );
}
```

### `useFormState`

This hook allows you to subscribe to changes in the form's state, such as `errors` or `isSubmitting`, without re-rendering the entire form.

**Example:**

```tsx
import { useForm, useFormState } from "react-hook-form";

function MyForm() {
  const { control, register, handleSubmit } = useForm();
  const { isSubmitting } = useFormState({ control });

  return (
    <form onSubmit={handleSubmit(console.log)}>
      <input {...register("firstName")} />
      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Submitting..." : "Submit"}
      </button>
    </form>
  );
}
```

## Form Submission

### `handleSubmit`

Always use the `handleSubmit` function provided by RHF to handle form submissions. It will automatically prevent the default form submission behavior and run your validation before calling your submission handler.

## Advanced Patterns

### `useFormContext`

For complex or nested forms, `useFormContext` allows you to share form state between components without passing props down the tree.

**Example:**

```tsx
import { useForm, FormProvider, useFormContext } from "react-hook-form";

function MyForm() {
  const methods = useForm();
  const onSubmit = (data) => console.log(data);

  return (
    <FormProvider {...methods}>
      <form onSubmit={methods.handleSubmit(onSubmit)}>
        <MyInput />
        <button type="submit">Submit</button>
      </form>
    </FormProvider>
  );
}

function MyInput() {
  const { register } = useFormContext();
  return <input {...register("firstName")} />;
}
```

## Error Handling Best Practices

### Server-Side Errors

When handling server errors, use the `setError` method to display them in context:

```tsx
const onSubmit = async (data) => {
  try {
    const result = await apiCall(data);
    if (!result.success) {
      // Set field-specific errors
      if (result.fieldErrors) {
        Object.entries(result.fieldErrors).forEach(([field, message]) => {
          setError(field as Path<FormData>, {
            type: "manual",
            message,
          });
        });
      }

      // Set general form error
      setError("root.serverError", {
        type: "manual",
        message: result.message || "An error occurred",
      });
    }
  } catch (error) {
    setError("root.serverError", {
      type: "manual",
      message: "Network error. Please try again.",
    });
  }
};
```

## Testing React Hook Form

### Basic Testing Example

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MyForm } from "./MyForm";

describe("MyForm", () => {
  it("should validate required fields", async () => {
    const user = userEvent.setup();
    render(<MyForm onSubmit={jest.fn()} />);

    const submitButton = screen.getByRole("button", { name: /submit/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText("First name is required")).toBeInTheDocument();
    });
  });

  it("should submit valid form data", async () => {
    const user = userEvent.setup();
    const mockSubmit = jest.fn();
    render(<MyForm onSubmit={mockSubmit} />);

    await user.type(screen.getByLabelText(/first name/i), "John");
    await user.type(screen.getByLabelText(/last name/i), "Doe");
    await user.click(screen.getByRole("button", { name: /submit/i }));

    await waitFor(() => {
      expect(mockSubmit).toHaveBeenCalledWith({
        firstName: "John",
        lastName: "Doe",
      });
    });
  });
});
```

## TypeScript Patterns with Zod

### Advanced Type Inference

```tsx
// Define your schema
const userSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  role: z.enum(["admin", "user", "viewer"]),
  preferences: z.object({
    notifications: z.boolean(),
    theme: z.enum(["light", "dark", "auto"]),
  }),
});

// Infer the type from the schema
type UserFormData = z.infer<typeof userSchema>;

// Use in your form
function UserForm() {
  const form = useForm<UserFormData>({
    resolver: zodResolver(userSchema),
    defaultValues: {
      role: "user",
      preferences: {
        notifications: true,
        theme: "auto",
      },
    },
  });

  // TypeScript knows all the field names and types
  const role = form.watch("role"); // type: 'admin' | 'user' | 'viewer'
}
```

## Accessibility Guidelines

### Form Accessibility Best Practices

1. **Always use proper labels**:

```tsx
<FormField
  control={control}
  name="email"
  render={({ field }) => (
    <FormItem>
      <FormLabel htmlFor="email">Email Address</FormLabel>
      <FormControl>
        <Input {...field} id="email" type="email" />
      </FormControl>
      <FormMessage role="alert" />
    </FormItem>
  )}
/>
```

2. **Provide helpful error messages**:

```tsx
const schema = z.object({
  password: z
    .string()
    .min(8, "Password must be at least 8 characters long")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[0-9]/, "Password must contain at least one number"),
});
```

3. **Use ARIA attributes when needed**:

```tsx
<Input
  {...field}
  aria-invalid={!!errors.email}
  aria-describedby={errors.email ? "email-error" : undefined}
/>;
{
  errors.email && (
    <span id="email-error" role="alert" className="text-red-500">
      {errors.email.message}
    </span>
  );
}
```

## Custom Hook Patterns

### Creating Reusable Form Logic

```tsx
// useUserForm.ts
export function useUserForm(defaultValues?: Partial<UserFormData>) {
  const form = useForm<UserFormData>({
    resolver: zodResolver(userSchema),
    defaultValues: {
      name: "",
      email: "",
      role: "user",
      ...defaultValues,
    },
  });

  const onSubmit = async (data: UserFormData) => {
    try {
      await saveUser(data);
      toast.success("User saved successfully");
    } catch (error) {
      form.setError("root.serverError", {
        message: "Failed to save user",
      });
    }
  };

  return {
    ...form,
    onSubmit: form.handleSubmit(onSubmit),
  };
}

// Usage in component
function EditUserForm({ userId }: { userId: string }) {
  const { data: user } = useUser(userId);
  const { register, onSubmit, formState } = useUserForm(user);

  return <form onSubmit={onSubmit}>{/* Form fields */}</form>;
}
```

## React 19 Considerations

React 19 introduces new features for handling forms, including the `useActionState` hook. While these built-in features are promising, RHF still offers more advanced capabilities, especially for complex validation scenarios. For now, RHF remains a go-to solution for building robust and performant forms in React.
