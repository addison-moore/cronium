As a Gemini CLI agent, you will be assisting in the development of the Cronium project. A CONTEXT.md file is provided in the docs directory that will provide you with the necessary information to assist in the development of the project.

Environment variables are correctly configured and stored in the .env file.

The project is a Next.js 15 app with a Node.js backend. The app is using TailwindCSS 4 for styling.

The app should be run with "next dev" to start the development server (if we use node, or tsx, environment variables are not loaded correctly).

As you make changes to the code, you should log the changes to the changelog folder:

1. Check if a changelog file exists for today's date in the `changelog/` folder (e.g., `changelog/2025-07-07.md`)
2. If no file exists for today, create one with the filename `YYYY-MM-DD.md`
3. Add your changes to the appropriate file in the format:

```
- [YYYY-MM-DD] [Change Type] [Change Description]
```

Change types include: Feature, Bug Fix, Refactor, Documentation, Testing, etc.
