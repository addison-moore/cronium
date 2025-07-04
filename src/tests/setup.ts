import { jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';

// Global test setup
beforeAll(() => {
  // Ensure test directories exist
  const testDirs = [
    path.join(process.cwd(), 'tests/temp'),
    path.join(process.cwd(), 'tests/fixtures')
  ];
  
  testDirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
});

// Cleanup after each test
afterEach(() => {
  try {
    // Clean up temporary test files with retry logic
    const tempDir = path.join(process.cwd(), 'tests/temp');
    if (fs.existsSync(tempDir)) {
      // Change to a safe directory before cleanup
      const originalCwd = process.cwd();
      process.chdir(path.join(process.cwd(), 'tests'));
      
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
        fs.mkdirSync(tempDir, { recursive: true });
      } finally {
        process.chdir(originalCwd);
      }
    }
  } catch (error) {
    console.warn('Cleanup warning:', error.message);
  }
});

// Global timeout for all tests
jest.setTimeout(30000);