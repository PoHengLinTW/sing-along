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
    expect(c.presignTtlSec).toBe(900);
    expect(c.s3.forcePathStyle).toBe(false);
    expect(c.publicOrigin).toBe('http://localhost:5173');
  });

  it('defaults every cap to the PRD values', () => {
    expect(loadConfig(valid).caps).toEqual({
      maxFileBytes: 60 * 1024 * 1024,
      maxTrackMs: 600_000,
      maxTracksPerProject: 10,
      maxProjects: 100,
      maxStorageBytes: 8 * 1024 ** 3,
    });
  });

  it('reads cap overrides from the environment', () => {
    const c = loadConfig({
      ...valid,
      MAX_FILE_MB: '20',
      MAX_TRACK_MINUTES: '5',
      MAX_TRACKS_PER_PROJECT: '4',
      MAX_PROJECTS: '7',
      MAX_STORAGE_GB: '2',
    });
    expect(c.caps).toEqual({
      maxFileBytes: 20 * 1024 * 1024,
      maxTrackMs: 300_000,
      maxTracksPerProject: 4,
      maxProjects: 7,
      maxStorageBytes: 2 * 1024 ** 3,
    });
  });

  it('rejects a non-positive cap', () => {
    expect(() => loadConfig({ ...valid, MAX_PROJECTS: '0' })).toThrow(/MAX_PROJECTS/);
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
