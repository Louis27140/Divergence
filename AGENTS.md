# AGENTS.md

## Build/Lint/Test Commands

### Frontend

- **Development Server**:
  ```bash
  npm run dev
  ```

- **Build**:
  ```bash
  npm run build
  ```

- **Preview**:
  ```bash
  npm run preview
  ```

### Backend

- **Development Server**:
  ```bash
  npm run dev
  ```

- **Build**:
  ```bash
  npm run build
  ```

- **Start**:
  ```bash
  npm run start
  ```

## Code Style Guidelines

### Imports

- **Order**: Group imports in the following order:
  1. Node.js built-in modules
  2. External modules
  3. Internal modules

- **Formatting**:
  - Use single quotes for strings
  - Use trailing commas for multiline objects and arrays

### Types

- **Type Annotations**: Use TypeScript type annotations for function parameters and return types

### Naming Conventions

- **Variables**: Use camelCase for variable names
- **Functions**: Use camelCase for function names
- **Classes**: Use PascalCase for class names
- **Interfaces**: Use PascalCase for interface names

### Error Handling

- **Error Types**: Use custom error types for specific error scenarios
- **Error Logging**: Log errors with appropriate context

### Testing

- **Test Files**: Place test files in the same directory as the source files, with a `.test.ts` suffix
- **Test Structure**: Use the Arrange-Act-Assert pattern for test structure

### Linting and Formatting

- **Linting**: Run linting with ESLint
- **Formatting**: Use Prettier for code formatting

## Additional Guidelines

- **Code Reviews**: All code changes should be reviewed before merging
- **Documentation**: Keep documentation up-to-date with code changes

## Cursor Rules

- **Autocomplete**: Use Cursor's autocomplete feature to speed up coding
- **Code Snippets**: Utilize Cursor's code snippets for common patterns

## Copilot Instructions

- **Code Suggestions**: Use GitHub Copilot for code suggestions and completions
- **Code Reviews**: Utilize GitHub Copilot for code review suggestions

## Environment Setup

- **Node.js**: Use Node.js version 20 or higher
- **npm**: Use npm version 10 or higher

## Project Structure

- **Frontend**: Located in the `front` directory
- **Backend**: Located in the `back` directory

## Dependencies

- **Frontend**:
  - React
  - Vite
  - LiveKit Client
  - Socket.IO Client

- **Backend**:
  - Fastify
  - TypeScript
  - PostgreSQL
  - LiveKit Server SDK
  - Socket.IO

## Development Workflow

1. **Setup**: Clone the repository and install dependencies
2. **Development**: Run the development servers for both frontend and backend
3. **Testing**: Run tests to ensure code quality
4. **Linting**: Run linting to ensure code style compliance
5. **Building**: Build the project for production
6. **Deployment**: Deploy the built project to the production environment
