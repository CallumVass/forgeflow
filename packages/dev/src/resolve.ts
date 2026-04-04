import * as path from "node:path";
import { fileURLToPath } from "node:url";

// After bundling: extensions/index.js → up one level → agents/
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const AGENTS_DIR = path.resolve(__dirname, "..", "agents");
