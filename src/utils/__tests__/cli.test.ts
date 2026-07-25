// RT-08: unit coverage for parseCliFlags port validation.
// The parser calls die() which invokes process.exit(2); we stub process.exit
// to throw and catch.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { parseCliFlags } from '../cli.js';

describe('parseCliFlags --port validation (RT-08)', () => {
  let errSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  const install = () => {
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(((code?: string | number | null) => {
        throw new Error(`exit:${code ?? 0}`);
      }) as never);
  };

  afterEach(() => {
    errSpy?.mockRestore();
    exitSpy?.mockRestore();
  });

  it('accepts --port 3000', () => {
    const args = parseCliFlags(['--port', '3000']);
    expect(args.port).toBe(3000);
  });

  it('accepts --port=8080', () => {
    const args = parseCliFlags(['--port=8080']);
    expect(args.port).toBe(8080);
  });

  it('accepts --port 1 (min)', () => {
    const args = parseCliFlags(['--port', '1']);
    expect(args.port).toBe(1);
  });

  it('accepts --port 65535 (max)', () => {
    const args = parseCliFlags(['--port', '65535']);
    expect(args.port).toBe(65535);
  });

  it('rejects --port 0', () => {
    install();
    expect(() => parseCliFlags(['--port', '0'])).toThrow(/exit:2/);
    expect(errSpy.mock.calls[0][0]).toMatch(/positive decimal integer/);
  });

  it('rejects --port 65536', () => {
    install();
    expect(() => parseCliFlags(['--port', '65536'])).toThrow(/exit:2/);
    expect(errSpy.mock.calls[0][0]).toMatch(/\[1, 65535\]/);
  });

  it('rejects hex form --port 0x10', () => {
    install();
    expect(() => parseCliFlags(['--port', '0x10'])).toThrow(/exit:2/);
    expect(errSpy.mock.calls[0][0]).toMatch(/positive decimal integer/);
  });

  it('rejects scientific notation --port 1e4', () => {
    install();
    expect(() => parseCliFlags(['--port', '1e4'])).toThrow(/exit:2/);
    expect(errSpy.mock.calls[0][0]).toMatch(/positive decimal integer/);
  });

  it('rejects negative --port=-1', () => {
    install();
    expect(() => parseCliFlags(['--port=-1'])).toThrow(/exit:2/);
  });

  it('rejects --port with missing value', () => {
    install();
    expect(() => parseCliFlags(['--port'])).toThrow(/exit:2/);
    expect(errSpy.mock.calls[0][0]).toMatch(/requires a value/);
  });

  it('rejects --port=', () => {
    install();
    expect(() => parseCliFlags(['--port='])).toThrow(/exit:2/);
  });
});
