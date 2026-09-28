import { describe, expect, it } from 'vitest';
import { projectCreateSchema, projectUpdateSchema } from './index';

describe('projectCreateSchema', () => {
  it('trims and accepts a title', () => {
    expect(projectCreateSchema.parse({ title: '  My Song  ' })).toEqual({ title: 'My Song' });
  });
  it('rejects an empty or whitespace-only title', () => {
    expect(projectCreateSchema.safeParse({ title: '' }).success).toBe(false);
    expect(projectCreateSchema.safeParse({ title: '   ' }).success).toBe(false);
    expect(projectCreateSchema.safeParse({}).success).toBe(false);
  });
  it('rejects a title over 200 characters but accepts exactly 200', () => {
    expect(projectCreateSchema.safeParse({ title: 'a'.repeat(200) }).success).toBe(true);
    expect(projectCreateSchema.safeParse({ title: 'a'.repeat(201) }).success).toBe(false);
  });
  it('accepts optional artist and notes; empty strings become null', () => {
    expect(projectCreateSchema.parse({ title: 't', artist: 'A', notes: 'n' })).toEqual({
      title: 't',
      artist: 'A',
      notes: 'n',
    });
    expect(projectCreateSchema.parse({ title: 't', artist: '  ', notes: '' })).toEqual({
      title: 't',
      artist: null,
      notes: null,
    });
  });
});

describe('projectUpdateSchema', () => {
  it('is partial: only provided fields are present', () => {
    expect(projectUpdateSchema.parse({ artist: 'X' })).toEqual({ artist: 'X' });
    expect(projectUpdateSchema.parse({})).toEqual({});
  });
  it('still rejects an empty title when title is provided', () => {
    expect(projectUpdateSchema.safeParse({ title: '' }).success).toBe(false);
  });
});
