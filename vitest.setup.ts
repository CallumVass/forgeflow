import { initTheme } from "@mariozechner/pi-coding-agent";

// Initialise the pi-coding-agent theme so any code under test that calls
// `keyHint`, `theme.fg`, etc. doesn't throw "Theme not initialized" errors.
// Forcing "dark" avoids terminal background detection inside the test runner.
initTheme("dark", false);
