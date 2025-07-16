# Heavy Components Inventory

## Overview

This document provides a comprehensive inventory of components using heavy dependencies (Monaco Editor, XTerm.js, and XyFlow/ReactFlow) in the Cronium codebase.

## Monaco Editor Components

### Package Information

- **Package**: `@monaco-editor/react`
- **Version**: ^4.7.0
- **Estimated Bundle Size**: ~2MB (uncompressed)

### Component Usage

1. **Core Wrapper Component**
   - **File**: `/src/components/ui/monaco-editor.tsx`
   - **Purpose**: Central wrapper providing Cronium-specific features
   - **Features**: TypeScript intellisense, runtime helper definitions
   - **Used By**: All other Monaco instances

2. **Event Form Components**
   - **File**: `/src/components/event-form/EventForm.tsx`
   - **Usage**: Script editing for events
   - **File**: `/src/components/event-form/ConditionalActionsSection.tsx`
   - **Usage**: Conditional logic editing
   - **File**: `/src/components/event-form/ActionParameterForm.tsx`
   - **Usage**: Action parameter scripts

3. **Tool Templates**
   - **File**: `/src/components/tools/templates/TemplateActionParameterForm.tsx`
   - **Usage**: Template parameter editing

4. **Event Details**
   - **File**: `/src/components/event-details/EventDetailsTab.tsx`
   - **Usage**: Read-only script display

5. **Dashboard Components**
   - **File**: `/src/components/dashboard/AIScriptAssistant.tsx`
   - **Usage**: AI-assisted script generation
   - **File**: `/src/components/dashboard/CodeEditor.tsx`
   - **Usage**: Direct Monaco import for code editing

## XTerm.js Components

### Package Information

- **Packages**:
  - `@xterm/xterm`: ^5.5.0
  - `@xterm/addon-fit`: ^0.10.0
  - `@xterm/addon-unicode11`: ^0.8.0
  - `@xterm/addon-web-links`: ^0.11.0
- **Estimated Bundle Size**: ~500KB (uncompressed)

### Component Usage

1. **Terminal Component**
   - **File**: `/src/components/terminal/Terminal.tsx`
   - **Purpose**: Full terminal emulator
   - **Features**: WebSocket communication, SSH support, custom themes
   - **Addons**: fit, unicode11, web-links

2. **Console Page**
   - **File**: `/src/app/[lang]/dashboard/console/page.tsx`
   - **Usage**: Dashboard terminal interface
   - **Features**: Server selection, local/remote terminals

3. **Global Styles**
   - **File**: `/src/app/layout.tsx`
   - **Usage**: Imports XTerm CSS for terminal styling

## XyFlow/ReactFlow Components

### Package Information

- **Package**: `@xyflow/react`
- **Version**: ^12.8.1
- **Estimated Bundle Size**: ~300KB (uncompressed)

### Component Usage

1. **Action Builder System**
   - **Directory**: `/src/components/action-builder/`
   - **Main Component**: `ActionBuilder.tsx` (with ReactFlowProvider)
   - **Canvas**: `Canvas.tsx` (full ReactFlow implementation)
   - **Custom Nodes**: `ActionNode.tsx`
   - **Custom Edges**: `ActionEdge.tsx`
   - **State Management**: `useActionBuilder.ts`

2. **Workflow System**
   - **Directory**: `/src/components/workflows/`
   - **Main Component**: `WorkflowCanvas.tsx` (1108 lines - largest component)
   - **Form Integration**: `WorkflowForm.tsx`
   - **Custom Nodes**: `nodes/EventNode.tsx`
   - **Custom Edges**: `edges/ConnectionEdge.tsx`

3. **Workflow Pages**
   - **New Workflow**: `/src/app/[lang]/dashboard/workflows/new/page.tsx`
   - **Edit Workflow**: `/src/app/[lang]/dashboard/workflows/[id]/edit/page.tsx`
   - **View Workflow**: `/src/app/[lang]/dashboard/workflows/[id]/page.tsx`

## Other Heavy Dependencies Identified

### Chart Libraries

- **Package**: `recharts`
- **Version**: ^2.14.1
- **Usage**: Dashboard statistics and analytics
- **Files**: Various dashboard components

### Form Libraries

- **Package**: `react-hook-form`
- **Version**: ^7.54.2
- **Usage**: Throughout the application for form handling

### UI Component Libraries

- **Package**: `@radix-ui/*` (multiple packages)
- **Usage**: UI primitives throughout the app

## Lazy Loading Candidates

### High Priority (Immediate Impact)

1. **Monaco Editor** - Used in forms and editors
2. **Terminal Component** - Only used in console page
3. **Workflow Canvas** - Only used in workflow pages
4. **Action Builder** - Only used in action building contexts

### Medium Priority (Good Candidates)

1. **Chart Components** - Used in dashboard but not critical
2. **AI Script Assistant** - Feature-specific component
3. **Event Details Tab** - Only loaded when viewing events

### Low Priority (Already Route-Split)

1. **Admin Components** - Already in separate routes
2. **Documentation Pages** - Static content, already split

## Bundle Size Impact Estimation

Based on the dependencies identified:

- **Current Estimated Bundle**: ~3.5MB (uncompressed)
- **Potential Reduction**: 50-70% by lazy loading heavy components
- **Priority Components Size**: ~2.8MB (Monaco + XTerm + XyFlow)

## Next Steps

1. Set up Next.js Bundle Analyzer to get exact measurements
2. Implement dynamic imports for high-priority components
3. Create loading skeletons for better UX
4. Monitor performance improvements after each change
