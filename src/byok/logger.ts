import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

type LogLevel = 'off' | 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  off: -1,
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LOG_RETENTION_DAYS = 7;
const SENSITIVE_HEADER_KEYS = ['Authorization', 'x-api-key', 'x-goog-api-key'];

class Logger {
  private _level: LogLevel = 'off';
  private _logDir = '';
  private _initialized = false;

  init(logDir: string): void {
    this._logDir = logDir;
    this.reloadConfig();
    this.ensureLogDir();
    this._initialized = true;
  }

  reloadConfig(): void {
    const config = vscode.workspace.getConfiguration();
    this._level = config.get<LogLevel>('copilotHarness.byok.logLevel', 'off');
  }

  debug(tag: string, data: Record<string, unknown>): void {
    if (this._level === 'off' || LOG_LEVEL_PRIORITY[this._level] > LOG_LEVEL_PRIORITY.debug) {
      return;
    }
    this.write('debug', tag, data);
  }

  info(tag: string, data: Record<string, unknown>): void {
    if (this._level === 'off' || LOG_LEVEL_PRIORITY[this._level] > LOG_LEVEL_PRIORITY.info) {
      return;
    }
    this.write('info', tag, data);
  }

  warn(tag: string, data: Record<string, unknown>): void {
    if (this._level === 'off' || LOG_LEVEL_PRIORITY[this._level] > LOG_LEVEL_PRIORITY.warn) {
      return;
    }
    this.write('warn', tag, data);
  }

  error(tag: string, data: Record<string, unknown>): void {
    if (this._level === 'off' || LOG_LEVEL_PRIORITY[this._level] > LOG_LEVEL_PRIORITY.error) {
      return;
    }
    this.write('error', tag, data);
  }

  sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
    const sanitized: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      if (SENSITIVE_HEADER_KEYS.includes(key)) {
        const tokenPrefix = value.startsWith('Bearer ') ? 'Bearer ' : '';
        const token = value.startsWith('Bearer ') ? value.slice(7) : value;
        if (token.length <= 4) {
          sanitized[key] = tokenPrefix + '***';
        } else {
          sanitized[key] = tokenPrefix + token.slice(0, 4) + '***';
        }
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }

  sanitizeData(data: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (key === 'headers' && value && typeof value === 'object' && !Array.isArray(value)) {
        result[key] = this.sanitizeHeaders(value as Record<string, string>);
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        result[key] = this.sanitizeData(value as Record<string, unknown>);
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  private ensureLogDir(): void {
    if (!fs.existsSync(this._logDir)) {
      fs.mkdirSync(this._logDir, { recursive: true });
    }
  }

  private getLogFilePath(): string {
    const now = new Date();
    const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    return path.join(this._logDir, `copilotharness-${dateStr}.log`);
  }

  private write(level: string, tag: string, data: Record<string, unknown>): void {
    if (!this._initialized) {
      return;
    }

    const sanitizedData = this.sanitizeData(data);
    const logEntry = {
      ts: new Date().toISOString(),
      level,
      tag,
      data: sanitizedData,
    };

    const line = JSON.stringify(logEntry) + '\n';
    const filePath = this.getLogFilePath();

    try {
      fs.appendFileSync(filePath, line, 'utf8');
      this.cleanOldLogs();
    } catch (e) {
      console.error('[Copilot Harness BYOK Logger] Failed to write log:', e);
    }
  }

  private cleanOldLogs(): void {
    try {
      if (!fs.existsSync(this._logDir)) {
        return;
      }

      const files = fs.readdirSync(this._logDir);
      const now = new Date();
      const cutoffTime = now.getTime() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;

      for (const file of files) {
        const match = file.match(/^copilotharness-(\d{4})(\d{2})(\d{2})\.log$/);
        if (!match) {
          continue;
        }

        const year = parseInt(match[1], 10);
        const month = parseInt(match[2], 10) - 1;
        const day = parseInt(match[3], 10);
        const fileDate = new Date(year, month, day);

        if (fileDate.getTime() < cutoffTime) {
          const filePath = path.join(this._logDir, file);
          fs.unlinkSync(filePath);
        }
      }
    } catch (e) {
      console.error('[Copilot Harness BYOK Logger] Failed to clean old logs:', e);
    }
  }
}

export const logger = new Logger();
