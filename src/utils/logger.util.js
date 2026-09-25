/**
 * Backend File & Console Logger Utility
 * Captures all system events, HTTP requests, security events, and error logs into persistent files:
 *  - backend/logs/server.log
 *  - backend/logs/server.txt
 * Maintains live console output while ensuring complete forensic history on disk.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOGS_DIR = path.resolve(__dirname, '../../logs');
const LOG_FILE = path.join(LOGS_DIR, 'server.log');
const TXT_FILE = path.join(LOGS_DIR, 'server.txt');

// Ensure log directory exists
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

// Create append write streams
const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a', encoding: 'utf8' });
const txtStream = fs.createWriteStream(TXT_FILE, { flags: 'a', encoding: 'utf8' });

/**
 * Strips ANSI color escape codes from log strings before saving to disk
 */
function stripAnsi(str) {
  return typeof str === 'string' ? str.replace(/\x1B\[\d+m/g, '') : str;
}

/**
 * Format timestamp in ISO format: YYYY-MM-DD HH:mm:ss UTC
 */
function getTimestamp() {
  const d = new Date();
  return d.toISOString().replace('T', ' ').replace(/\..+/, '') + ' UTC';
}

/**
 * Writes formatted message line to both server.log and server.txt
 */
export function writeToLogFile(level, message) {
  try {
    const cleanMsg = stripAnsi(typeof message === 'object' ? JSON.stringify(message) : String(message));
    const line = `[${getTimestamp()}] [${level.toUpperCase()}] ${cleanMsg}\n`;
    logStream.write(line);
    txtStream.write(line);
  } catch (err) {
    // Fail silently on file write error to prevent server crash
  }
}

// Hook morgan HTTP request stream
export const morganFileStream = {
  write: (message) => {
    writeToLogFile('HTTP', message.trim());
  }
};

// Intercept standard console methods so existing console.log / warn / error calls automatically write to file
const originalLog = console.log;
const originalInfo = console.info;
const originalWarn = console.warn;
const originalError = console.error;

console.log = (...args) => {
  originalLog.apply(console, args);
  const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : a)).join(' ');
  writeToLogFile('INFO', msg);
};

console.info = (...args) => {
  originalInfo.apply(console, args);
  const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : a)).join(' ');
  writeToLogFile('INFO', msg);
};

console.warn = (...args) => {
  originalWarn.apply(console, args);
  const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : a)).join(' ');
  writeToLogFile('WARN', msg);
};

console.error = (...args) => {
  originalError.apply(console, args);
  const msg = args.map(a => (a instanceof Error ? `${a.message}\n${a.stack}` : typeof a === 'object' ? JSON.stringify(a) : a)).join(' ');
  writeToLogFile('ERROR', msg);
};

// Catch unhandled exceptions and unhandled rejections
process.on('uncaughtException', (err) => {
  writeToLogFile('FATAL_CRASH', `Uncaught Exception: ${err.message}\n${err.stack}`);
});

process.on('unhandledRejection', (reason, promise) => {
  writeToLogFile('UNHANDLED_REJECTION', `Unhandled Rejection: ${reason}`);
});

export default {
  LOGS_DIR,
  LOG_FILE,
  TXT_FILE,
  writeToLogFile,
  morganFileStream
};
