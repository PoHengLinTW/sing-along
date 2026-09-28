import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config';

const valid = {
  DATABASE_URL: 'postgres://u:p@localhost:5433/db',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_REGION: 'auto',
  S3_BUCKET: 'sing-along',
  S3_ACCESS_KEY_ID: 'key',
  S3_SECRET_ACCESS_KEY: 'secret',
  PUBLIC_ORIGIN: 'http://localhost:5173',
};

describe('loadConfig', () => {
  it('parses a valid environment and applies defaults', () => {
    const c = loadConfig(valid);
    expect(c.port).toBe(3100);
    expect(c.databaseUrl).toBe(valid.DATABASE_URL);
    expect(c.s3.bucket).toBe('sing-along');
    expect(c.s3.forcePathStyle).toBe(false);
    expect(c.publicOrigin).toBe('http://localhost:5173');
  });

  it('reads PORT and S3_FORCE_PATH_STYLE', () => {
    const c = loadConfig({ ...valid, PORT: '4000', S3_FORCE_PATH_STYLE: 'true' });
    expect(c.port).toBe(4000);
    expect(c.s3.forcePathStyle).toBe(true);
  });

  it('names every missing variable in one error', () => {
    const { DATABASE_URL: _d, S3_BUCKET: _b, ...rest } = valid;
    try {
      loadConfig(rest);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      expect((e as Error).message).toContain('DATABASE_URL');
      expect((e as Error).message).toContain('S3_BUCKET');
      expect((e as Error).message).toContain('.env.example');
    }
  });

  it('rejects invalid values with the variable name', () => {
    expect(() => loadConfig({ ...valid, S3_ENDPOINT: 'not a url' })).toThrow(/S3_ENDPOINT/);
    expect(() => loadConfig({ ...valid, PORT: 'abc' })).toThrow(/PORT/);
  });
});
