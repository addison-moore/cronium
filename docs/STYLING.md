# Cronium Styling Guide

This document outlines the styling conventions and architecture of the Cronium application, which uses Next.js 15 and is styled with TailwindCSS 4.

## Core Principles

Our styling is built upon a set of core principles that ensure consistency, maintainability, and a high-quality user experience.

- **Utility-First:** We primarily use TailwindCSS utility classes for styling. This allows for rapid development and avoids the need for large, custom CSS files.
- **Theming:** We use a comprehensive theming system to manage colors, fonts, and other design tokens. This allows for easy switching between light and dark modes and ensures a consistent look and feel across the application.
- **Component-Based:** Styles are organized by component, making it easy to find and update styles for specific parts of the application.
- **Responsive Design:** The application is designed to be responsive and work on a variety of screen sizes.

## File Structure

The main styling files are located in the `src/app/styles` directory:

- **`global.css`**: This file contains the core of our styling system. It defines our light and dark mode themes, sets up our design tokens using the `@theme` directive, and includes base styles for the entire application.
- **`components.css`**: This file contains component-specific styles. These are styles that are reused across multiple components but are not general enough to be included in `global.css`.
- **`utilities.css`**: This file contains custom utility classes that extend Tailwind's default set.

## Theming

Our theming system is defined in `src/app/styles/global.css`. We use CSS custom properties (variables) to define our color palette, fonts, and other design tokens.

### Color Palette

We have a comprehensive color palette that includes primary, secondary, accent, and status colors. Each color has a corresponding foreground color to ensure readability.

- **`--primary-color`**: The main brand color.
- **`--secondary-color`**: A secondary brand color.
- **`--accent-color`**: A color used for accents and highlights.
- **`--destructive-color`**: Used for destructive actions, such as deleting an item.
- **`--success-color`**: Used for success messages and indicators.
- **`--warning-color`**: Used for warnings and alerts.
- **`--info-color`**: Used for informational messages.

### Light and Dark Modes

We support both light and dark modes. The theme is determined by the presence of the `.dark` class on the `html` element. The colors for each mode are defined in the `:root` and `.dark` selectors in `global.css`.

## TailwindCSS Configuration

Our TailwindCSS configuration is located in `tailwind.config.ts`. As of TailwindCSS 4, the configuration is CSS-first, meaning most of our configuration is done directly in our CSS files.

- **`darkMode`**: We use the `class` strategy for dark mode, which allows us to toggle dark mode by adding or removing the `.dark` class from the `html` element.
- **`content`**: This is where we tell Tailwind which files to scan for utility classes.
- **`theme.extend`**: We use this to extend Tailwind's default theme with our own custom animations and keyframes. However, the best practice for TailwindCSS 4 is to define these in the `@theme` block in `global.css`.

## Best Practices and Recommendations

Based on the latest TailwindCSS 4 best practices, here are some recommendations for the Cronium project:

1.  **Embrace CSS-First Configuration**: We are already using the `@theme` directive in `global.css` to define our design tokens. We should continue to do so and move any remaining theme customizations from `tailwind.config.ts` to `global.css`.

2.  **Simplify the Build Process**: TailwindCSS 4 includes `autoprefixer` and other PostCSS features out of the box. We can simplify our `postcss.config.mjs` file by removing the `autoprefixer` plugin. We should also remove the `autoprefixer` dependency from our `package.json`.

3.  **Leverage Modern CSS**: We should make use of modern CSS features like `:has()` and container queries to create more robust and responsive components.

4.  **Component Abstraction**: We should continue to create reusable components in React to encapsulate our styles and markup. This will help to keep our codebase clean and maintainable.

5.  **Remove Redundant `postcss.config.mjs`**: Since we are using Next.js 15, which has built-in support for PostCSS, and TailwindCSS 4 is an all-in-one tool, we can likely remove the `postcss.config.mjs` file entirely. Next.js will automatically configure PostCSS for us.

## Component Styling

Component-specific styles are defined in `src/app/styles/components.css`. We use the `@layer components` directive to create custom component classes. This allows us to group related styles together and apply them to components with a single class.

For example, we have a `.btn` class that defines the base styles for all buttons. We then have modifier classes, such as `.btn-primary` and `.btn-secondary`, that apply color and other variations.

### Border Styling Convention

**Important:** All components requiring border styling should use the standard border classes to ensure correct theming and consistency across the application:

- **Standard Border**: Use `border border-border` for all components that need borders
- **Conditional Borders**: When adding borders conditionally, combine with the standard pattern: `border border-border`
- **Error States**: For error states, use `border border-red-500` to override the default border color

Examples:

```tsx
// Standard border
<div className="border border-border p-4">

// Conditional border with error state
<div className={cn("border border-border", hasError && "border-red-500")}>

// Toggle/switch container
<div className="border border-border rounded-lg p-4">
```

The `border-border` class ensures that borders use the correct color from our theming system, automatically adapting to light and dark modes.

## Utility Classes

We have a set of custom utility classes defined in `src/app/styles/utilities.css`. These classes provide additional functionality that is not included in Tailwind's default set.

For example, we have a `.gradient-text` class that applies a gradient to text, and a `.card-hover` class that adds a hover effect to cards.

## Solarized Theme for Terminal

We use the Solarized color scheme for our terminal component. The colors are defined as CSS custom properties in `global.css` and applied to the terminal component using utility classes.

## Conclusion

Our styling architecture is designed to be flexible, maintainable, and easy to use. By following the conventions outlined in this document, we can ensure a consistent and high-quality user experience across the entire application.
