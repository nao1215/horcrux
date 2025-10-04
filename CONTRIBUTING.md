# Contributing Guide

## Introduction

Thank you for considering contributing to the Horcrux project! This document explains how to contribute. We welcome all forms of contributions, including code, documentation, bug reports, and feature suggestions.

## Setting Up Development Environment

### Prerequisites

#### Installing Node.js and npm

Horcrux development requires Node.js (v18 or later) and npm.

**macOS (using Homebrew)**
```bash
brew install node
```

**Linux (Ubuntu)**
```bash
sudo apt update
sudo apt install nodejs npm
```

**Windows**
Download and run the installer from the [official Node.js website](https://nodejs.org/).

Verify installation:
```bash
node -v
npm -v
```

### Cloning the Project

```bash
git clone https://github.com/nao1215/horcrux.git
cd horcrux
```

### Installing Dependencies

```bash
npm install
```

### Verification

To verify your environment, run:

```bash
npm test
npm run lint
```

## Development Workflow

### Branch Strategy

- `main` branch is the latest stable version
- Create new branches from `main` for features or bug fixes
- Branch naming examples:
  - `feature/add-react-native-support`
  - `fix/issue-123`
  - `docs/update-readme`

### Coding Standards

This project follows these standards:

1. **Conform to [TypeScript best practices](https://www.typescriptlang.org/docs/handbook/declaration-files/do-s-and-don-ts.html)**
2. **Avoid global variables**
3. **Add comments to public functions, variables, and classes**
4. **Keep functions small and focused**
5. **Write tests for new code**

### Writing Tests

Tests are important. Please follow these guidelines:

1. **Unit tests**: Aim for 80% or higher coverage
2. **Test readability**: Write clear test cases
3. **Use Jest**: All tests should run with `npm test`

Test example:
```typescript
test('should split file into horcruxes', async () => {
  const result = await split('secret.txt', 3, 2);
  expect(result.horcruxes).toHaveLength(3);
});
```

## Using AI Assistants (LLMs)

We encourage the use of AI coding assistants (e.g., GitHub Copilot, Claude, Cursor) for:

- Writing boilerplate code
- Generating tests
- Improving documentation
- Refactoring code
- Finding bugs
- Suggesting optimizations
- Translating documentation

### Guidelines for AI-Assisted Development

1. **Review all generated code before committing**
2. **Maintain consistency with project standards**
3. **Test thoroughly**: All code must pass tests and linting (`npm test`, `npm run lint`)
4. **Use project configuration files**: `.github/copilot-instructions.md`, etc.

## Creating Pull Requests

### Preparation

1. **Check or Create Issues**
   - Check for existing issues
   - For major changes, discuss in an issue first

2. **Write Tests**
   - Add tests for new features
   - For bug fixes, create tests that reproduce the bug

3. **Quality Check**
   ```bash
   npm test
   npm run lint
   npm run test:coverage
   ```

### Submitting Pull Request

1. Create a Pull Request from your fork to the main repository
2. PR title should briefly describe the changes
3. Include in PR description:
   - Purpose and content of changes
   - Related issue number (if any)
   - Test method
   - Reproduction steps for bug fixes

### About CI/CD

GitHub Actions automatically checks:

- **Cross-platform testing**: Linux, macOS, Windows
- **Linter check**: ESLint
- **Test coverage**: 80% or higher
- **Build verification**

Merging is not possible unless all checks pass.

## Bug Reports

When you find a bug, please create an issue with:

1. **Environment Information**
   - OS and version
   - Node.js and npm version
   - Horcrux version

2. **Reproduction Steps**
   - Minimal code example
   - Data files used (if possible)

3. **Expected and Actual Behavior**

4. **Error Messages or Stack Traces**

## Contributing Outside of Coding

The following activities are also welcome:

### Activities that Boost Motivation

- **Give a GitHub Star**
- **Promote the Project**: Blogs, social media, study groups, etc.
- **Become a GitHub Sponsor**: [https://github.com/sponsors/nao1215](https://github.com/sponsors/nao1215)

### Other Ways to Contribute

- **Documentation Improvements**
- **Translations**
- **Add Examples**
- **Feature Suggestions**

## Community

### Code of Conduct

Please refer to [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). All contributors are expected to treat each other with respect.

### Questions and Reports

- **GitHub Issues**: Bug reports and feature suggestions

## License

Contributions are released under the project's license (MIT License).

---

Thank you again for considering contributing! We look forward to your participation.
