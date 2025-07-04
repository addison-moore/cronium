# React Hook Form Migration Checklist

Use this checklist when migrating a form from `useState` or other state management to React Hook Form.

## Pre-Migration Analysis

- [ ] **Identify the current form implementation**
  - [ ] Using `useState` for each field
  - [ ] Using a single state object
  - [ ] Using a state management library (Redux, MobX, etc.)
  - [ ] Using refs or uncontrolled components

- [ ] **Document current functionality**
  - [ ] List all form fields and their types
  - [ ] Note any conditional fields or dynamic behavior
  - [ ] Identify validation rules
  - [ ] Document submission logic
  - [ ] Note any side effects (API calls, navigation, etc.)

## Migration Steps

### 1. Setup

- [ ] Install required packages:
  ```bash
  npm install react-hook-form zod @hookform/resolvers
  ```

- [ ] Create Zod schema for validation:
  ```tsx
  const formSchema = z.object({
    // Add your fields here
  });
  
  type FormData = z.infer<typeof formSchema>;
  ```

### 2. Form Initialization

- [ ] Replace state hooks with `useForm`:
  ```tsx
  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      // Set default values
    },
  });
  ```

- [ ] Remove old state declarations (`useState` calls)

### 3. Input Migration

For each form input:

- [ ] **Standard HTML inputs** (input, textarea, select):
  - [ ] Replace `value` and `onChange` with `{...form.register("fieldName")}`
  - [ ] Add proper TypeScript types if using TS

- [ ] **Custom/Third-party components** (Material-UI, Ant Design, etc.):
  - [ ] Wrap with `Controller` component
  - [ ] Use `render` prop to pass field props

- [ ] **Checkboxes and Radio buttons**:
  - [ ] For single checkbox: use `{...form.register("fieldName")}`
  - [ ] For checkbox groups: consider using `Controller`

### 4. Validation

- [ ] Remove manual validation logic
- [ ] Ensure all validation rules are in the Zod schema
- [ ] Add custom validation with `.refine()` if needed
- [ ] Test that validation messages appear correctly

### 5. Error Handling

- [ ] Replace error state with `form.formState.errors`
- [ ] Update error display:
  ```tsx
  {form.formState.errors.fieldName && (
    <span>{form.formState.errors.fieldName.message}</span>
  )}
  ```
- [ ] Add accessibility attributes:
  ```tsx
  aria-invalid={!!form.formState.errors.fieldName}
  aria-describedby={form.formState.errors.fieldName ? "fieldName-error" : undefined}
  ```

### 6. Form Submission

- [ ] Replace form submit handler with `form.handleSubmit(onSubmit)`
- [ ] Update submit button to show loading state:
  ```tsx
  <button disabled={form.formState.isSubmitting}>
    {form.formState.isSubmitting ? "Submitting..." : "Submit"}
  </button>
  ```
- [ ] Handle server errors with `form.setError()`

### 7. Special Cases

- [ ] **Dynamic fields**: Use `useFieldArray` for lists
- [ ] **Dependent fields**: Use `form.watch()` to observe changes
- [ ] **Conditional validation**: Use Zod's `.refine()` method
- [ ] **File uploads**: May need special handling with `Controller`

## Post-Migration Testing

### Functionality Testing

- [ ] All fields accept input correctly
- [ ] Validation works as expected
- [ ] Error messages display properly
- [ ] Form submission works
- [ ] Default values are set correctly
- [ ] Conditional fields show/hide properly

### Performance Testing

- [ ] Form doesn't re-render excessively
- [ ] No performance regression
- [ ] Large forms remain responsive

### Accessibility Testing

- [ ] Form can be navigated with keyboard
- [ ] Screen readers announce errors properly
- [ ] Labels are associated with inputs
- [ ] Focus management works correctly

## Code Review Checklist

- [ ] No `useState` calls remain for form data
- [ ] All inputs are properly registered
- [ ] Validation is handled by Zod schema
- [ ] TypeScript types are properly inferred
- [ ] No `any` types used
- [ ] Error handling is comprehensive
- [ ] Loading states are handled
- [ ] Code follows team conventions

## Common Issues to Check

- [ ] **Forgot to spread field props**: Ensure `{...field}` or `{...register()}` is used
- [ ] **Wrong error access**: Use `errors.fieldName.message`, not just `errors.fieldName`
- [ ] **Missing Controller**: Custom components need `Controller` wrapper
- [ ] **Stale closures**: Be careful with `watch()` in callbacks
- [ ] **Type mismatches**: Ensure form data types match schema

## Final Steps

- [ ] Remove old form state logic
- [ ] Remove unused imports
- [ ] Update component tests
- [ ] Update documentation
- [ ] Create PR with clear description of changes