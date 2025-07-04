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

### Displaying Root Errors

Display general form errors at the top of your form:

```tsx
function MyForm() {
  const {
    handleSubmit,
    formState: { errors },
  } = useForm();

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      {errors.root?.serverError && (
        <Alert variant="destructive">
          <AlertDescription>{errors.root.serverError.message}</AlertDescription>
        </Alert>
      )}
      {/* Form fields */}
    </form>
  );
}
```

### Async Validation with Error Handling

```tsx
const schema = z.object({
  username: z
    .string()
    .min(3)
    .refine(async (username) => {
      try {
        const available = await checkUsernameAvailability(username);
        return available;
      } catch (error) {
        // Network errors should not fail validation
        console.error("Failed to check username:", error);
        return true;
      }
    }, "Username is already taken"),
});
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

### Testing Forms with Controller Components

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MyFormWithSelect } from "./MyFormWithSelect";

describe("MyFormWithSelect", () => {
  it("should handle select changes", async () => {
    const user = userEvent.setup();
    const mockSubmit = jest.fn();
    render(<MyFormWithSelect onSubmit={mockSubmit} />);

    // Open select dropdown
    await user.click(screen.getByRole("combobox"));

    // Select an option
    await user.click(screen.getByRole("option", { name: "Admin" }));

    // Submit form
    await user.click(screen.getByRole("button", { name: /submit/i }));

    await waitFor(() => {
      expect(mockSubmit).toHaveBeenCalledWith({
        role: "admin",
      });
    });
  });
});
```

### Testing Async Validation

```tsx
describe("Form with async validation", () => {
  it("should show error for duplicate username", async () => {
    const user = userEvent.setup();

    // Mock the API call
    jest.mocked(checkUsernameAvailability).mockResolvedValue(false);

    render(<SignUpForm />);

    await user.type(screen.getByLabelText(/username/i), "existinguser");

    // Trigger validation by moving to next field
    await user.tab();

    await waitFor(() => {
      expect(screen.getByText("Username is already taken")).toBeInTheDocument();
    });
  });
});
```

### Testing Form Reset

```tsx
it("should reset form after successful submission", async () => {
  const user = userEvent.setup();
  render(<MyForm />);

  const input = screen.getByLabelText(/name/i);
  await user.type(input, "John Doe");

  await user.click(screen.getByRole("button", { name: /submit/i }));

  await waitFor(() => {
    expect(input).toHaveValue("");
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

### Conditional Validation with Zod

```tsx
const formSchema = z
  .object({
    accountType: z.enum(["personal", "business"]),
    firstName: z.string().min(1, "First name is required"),
    lastName: z.string().min(1, "Last name is required"),
    companyName: z.string().optional(),
    taxId: z.string().optional(),
  })
  .refine(
    (data) => {
      if (data.accountType === "business") {
        return !!data.companyName && data.companyName.length > 0;
      }
      return true;
    },
    {
      message: "Company name is required for business accounts",
      path: ["companyName"],
    },
  )
  .refine(
    (data) => {
      if (data.accountType === "business") {
        return !!data.taxId && data.taxId.length > 0;
      }
      return true;
    },
    {
      message: "Tax ID is required for business accounts",
      path: ["taxId"],
    },
  );
```

### Dynamic Form Schemas

```tsx
// Create schema based on dynamic conditions
function createFormSchema(includeAddress: boolean) {
  const baseSchema = z.object({
    name: z.string().min(1, "Name is required"),
    email: z.string().email("Invalid email address"),
  });

  if (includeAddress) {
    return baseSchema.extend({
      address: z.object({
        street: z.string().min(1, "Street is required"),
        city: z.string().min(1, "City is required"),
        zipCode: z.string().regex(/^\d{5}$/, "Invalid ZIP code"),
      }),
    });
  }

  return baseSchema;
}

// Use in component
function DynamicForm({ includeAddress }: { includeAddress: boolean }) {
  const schema = createFormSchema(includeAddress);
  type FormData = z.infer<typeof schema>;

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
  });
}
```

### Transform and Preprocess Data

```tsx
const schema = z.object({
  price: z
    .string()
    .transform((val) => parseFloat(val))
    .pipe(z.number().min(0, "Price must be positive")),
  tags: z
    .string()
    .transform((val) => val.split(",").map((tag) => tag.trim()))
    .pipe(z.array(z.string().min(1))),
  publishDate: z
    .string()
    .transform((val) => new Date(val))
    .pipe(z.date()),
});
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

## Common Pitfalls and Solutions

### 1. Forgetting to spread field props

**❌ Wrong:**

```tsx
<Controller
  name="email"
  control={control}
  render={({ field }) => (
    <Input value={field.value} onChange={field.onChange} />
  )}
/>
```

**✅ Correct:**

```tsx
<Controller
  name="email"
  control={control}
  render={({ field }) => <Input {...field} />}
/>
```

### 2. Using useState for form values

**❌ Wrong:**

```tsx
const [name, setName] = useState("");
<input value={name} onChange={(e) => setName(e.target.value)} />;
```

**✅ Correct:**

```tsx
const { register } = useForm();
<input {...register("name")} />;
```

### 3. Not handling loading states properly

**❌ Wrong:**

```tsx
<button type="submit">Submit</button>
```

**✅ Correct:**

```tsx
const {
  formState: { isSubmitting },
} = useForm();
<button type="submit" disabled={isSubmitting}>
  {isSubmitting ? "Submitting..." : "Submit"}
</button>;
```

### 4. Incorrect error display

**❌ Wrong:**

```tsx
{
  errors.email && <span>{errors.email}</span>;
}
```

**✅ Correct:**

```tsx
{
  errors.email && <span>{errors.email.message}</span>;
}
```

## Complex Form Patterns

### Dynamic Field Arrays

```tsx
import { useFieldArray } from "react-hook-form";

const schema = z.object({
  users: z
    .array(
      z.object({
        name: z.string().min(1, "Name is required"),
        email: z.string().email("Invalid email"),
      }),
    )
    .min(1, "At least one user is required"),
});

function UserListForm() {
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      users: [{ name: "", email: "" }],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "users",
  });

  return (
    <form onSubmit={form.handleSubmit(onSubmit)}>
      {fields.map((field, index) => (
        <div key={field.id}>
          <Controller
            name={`users.${index}.name`}
            control={form.control}
            render={({ field }) => <Input {...field} placeholder="Name" />}
          />
          <Controller
            name={`users.${index}.email`}
            control={form.control}
            render={({ field }) => <Input {...field} placeholder="Email" />}
          />
          <Button type="button" onClick={() => remove(index)}>
            Remove
          </Button>
        </div>
      ))}
      <Button type="button" onClick={() => append({ name: "", email: "" })}>
        Add User
      </Button>
    </form>
  );
}
```

### Multi-Step Forms

```tsx
function MultiStepForm() {
  const [step, setStep] = useState(1);
  const form = useForm({
    resolver: zodResolver(schema),
    mode: "onChange", // Validate on change for better UX
  });

  const nextStep = async () => {
    // Validate current step fields
    const fields = step === 1 ? ["firstName", "lastName"] : ["email", "phone"];

    const isValid = await form.trigger(fields);
    if (isValid) setStep(step + 1);
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)}>
      {step === 1 && (
        <>
          <Input {...form.register("firstName")} />
          <Input {...form.register("lastName")} />
        </>
      )}
      {step === 2 && (
        <>
          <Input {...form.register("email")} />
          <Input {...form.register("phone")} />
        </>
      )}

      {step < 2 ? (
        <Button type="button" onClick={nextStep}>
          Next
        </Button>
      ) : (
        <Button type="submit">Submit</Button>
      )}
    </form>
  );
}
```

### Dependent Fields

```tsx
function DependentFieldsForm() {
  const form = useForm();
  const country = form.watch("country");

  return (
    <form>
      <Controller
        name="country"
        control={form.control}
        render={({ field }) => (
          <Select {...field}>
            <option value="us">United States</option>
            <option value="ca">Canada</option>
          </Select>
        )}
      />

      {country === "us" && (
        <Controller
          name="state"
          control={form.control}
          render={({ field }) => (
            <Select {...field}>
              <option value="ny">New York</option>
              <option value="ca">California</option>
            </Select>
          )}
        />
      )}

      {country === "ca" && (
        <Controller
          name="province"
          control={form.control}
          render={({ field }) => (
            <Select {...field}>
              <option value="on">Ontario</option>
              <option value="bc">British Columbia</option>
            </Select>
          )}
        />
      )}
    </form>
  );
}
```

## React 19 Considerations

React 19 introduces new features for handling forms, including the `useActionState` hook. While these built-in features are promising, RHF still offers more advanced capabilities, especially for complex validation scenarios. For now, RHF remains a go-to solution for building robust and performant forms in React.
