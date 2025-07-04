
---

### 📄 `docs/FORMS.md`

```markdown
# 🧾 Cronium Forms & Validation Refactor

## Current State

- Many forms are currently using local React state

---

## Target Stack

- Use **react-hook-form (v7+)**
- Schema validation using **Zod**
- Integration with `tRPC` (if used) to reuse server-side schema

---

## Why RHF?

- Less boilerplate
- Better performance (fewer re-renders)
- Cleaner validation + error handling
- Tight integration with Zod and tRPC

---

## Example: Workflow Form

```tsx
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

const schema = z.object({
  name: z.string().min(1, "Workflow name is required"),
});

type FormData = z.infer<typeof schema>;

export function WorkflowForm({ onSubmit }: { onSubmit: (data: FormData) => void }) {
  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <input {...register("name")} placeholder="Workflow name" className="input" />
      {errors.name && <p className="text-red-500">{errors.name.message}</p>}
      <button type="submit" className="btn">Save</button>
    </form>
  );
}
```

### Migration Plan

- Install react-hook-form, zod, @hookform/resolvers
- Refactor forms one at a time starting with:
  - Workflow creation/editing
  - Event configuration
  - Variable input
  - Server management
- Ensure error messages and types are fully typed
- Integrate with tRPC where applicable