import { describe, test, expect } from 'vitest';
import { renderNamingTemplate, splitExt, type NamingContext } from '../naming.js';

function ctx(overrides: Partial<NamingContext> = {}): NamingContext {
  return {
    project: 'DEMO01',
    sequence: 'SEQ010',
    shot: 'sh010',
    versionLabel: 'v003',
    versionNumber: 3,
    provider: 'google-ai-studio',
    index: 0,
    originalFilename: 'gemini_0.png',
    slots: { element: 'BG', descriptor: 'AtriumWide', artist: 'AD', stage: 'styled', frame: 'F01' },
    ...overrides,
  };
}

describe('splitExt', () => {
  test('splits base and extension', () => {
    expect(splitExt('a.png')).toEqual({ base: 'a', ext: 'png' });
    expect(splitExt('a.b.mp4')).toEqual({ base: 'a.b', ext: 'mp4' });
    expect(splitExt('noext')).toEqual({ base: 'noext', ext: '' });
    expect(splitExt('.hidden')).toEqual({ base: '.hidden', ext: '' }); // leading dot ≠ ext
  });
});

describe('renderNamingTemplate', () => {
  test('renders the full Hybrid-v1 name', () => {
    const out = renderNamingTemplate(
      '{project}_{sequence}_{shot:upper}_{slot:frame}_{slot:element}_{slot:descriptor}_{slot:artist}_{version}_{slot:stage}',
      ctx(),
    );
    expect(out).toBe('DEMO01_SEQ010_SH010_F01_BG_AtriumWide_AD_v003_styled.png');
  });

  test('empty slots collapse cleanly (no stray separators)', () => {
    const out = renderNamingTemplate(
      '{project}_{sequence}_{shot:upper}_{slot:element}_{slot:descriptor}_{version}',
      ctx({ slots: {} }),
    );
    expect(out).toBe('DEMO01_SEQ010_SH010_v003.png');
  });

  test('appends the original extension when the template omits {ext}', () => {
    expect(renderNamingTemplate('{project}_{shot}_{version}', ctx())).toBe('DEMO01_sh010_v003.png');
  });

  test('explicit {ext} is used as-is', () => {
    expect(renderNamingTemplate('{shot}_{version}.{ext}', ctx())).toBe('sh010_v003.png');
  });

  test('a dot inside a token value does NOT suppress the extension append', () => {
    // 'Atrium.Wide' has an interior dot that must not be misread as an extension.
    expect(renderNamingTemplate('{slot:descriptor}_{version}', ctx({ slots: { descriptor: 'Atrium.Wide' } }))).toBe('Atrium.Wide_v003.png');
    // {basename} of a provider file with a dotted stem keeps its extension.
    expect(renderNamingTemplate('{basename}', ctx({ originalFilename: 'ComfyUI_v2.1_00001.png' }))).toBe('ComfyUI_v2.1_00001.png');
  });

  test('an empty optional slot before .{ext} does not eat the extension separator', () => {
    expect(renderNamingTemplate('{shot}_{slot:stage}.{ext}', ctx({ slots: {} }))).toBe('sh010.png');
    // with a stage present it fills normally
    expect(renderNamingTemplate('{shot}_{slot:stage}.{ext}', ctx({ slots: { stage: 'styled' } }))).toBe('sh010_styled.png');
  });

  test('modifiers: upper / lower / pad', () => {
    expect(renderNamingTemplate('{shot:upper}', ctx())).toBe('SH010.png');
    expect(renderNamingTemplate('{provider:upper}_{version_num:pad3}', ctx())).toBe('GOOGLE-AI-STUDIO_003.png');
    expect(renderNamingTemplate('{version_num:pad4}', ctx({ versionNumber: 12 }))).toBe('0012.png');
  });

  test('index and basename tokens', () => {
    expect(renderNamingTemplate('{shot}_{index}_{basename}', ctx({ index: 2 }))).toBe('sh010_2_gemini_0.png');
  });

  test('empty / whitespace template → null (caller falls back)', () => {
    expect(renderNamingTemplate('', ctx())).toBeNull();
    expect(renderNamingTemplate('   ', ctx())).toBeNull();
    expect(renderNamingTemplate(null, ctx())).toBeNull();
  });

  test('a template of only-empty tokens → null', () => {
    expect(renderNamingTemplate('{slot:nope}', ctx({ slots: {} }))).toBeNull();
  });

  test('path-traversal in a slot is neutralized, never escapes', () => {
    const out = renderNamingTemplate('{slot:element}_{version}', ctx({ slots: { element: '../../etc/passwd' } }));
    expect(out).not.toContain('..');
    expect(out).not.toContain('/');
    expect(out).toContain('v003');
  });

  test('unknown placeholder resolves to empty and collapses', () => {
    expect(renderNamingTemplate('{project}_{bogus}_{version}', ctx())).toBe('DEMO01_v003.png');
  });

  test('null provider collapses the provider token', () => {
    expect(renderNamingTemplate('{project}_{provider}_{version}', ctx({ provider: null }))).toBe('DEMO01_v003.png');
  });

  test('deterministic for identical input', () => {
    const c = ctx();
    expect(renderNamingTemplate('{project}_{shot}_{version}', c)).toBe(
      renderNamingTemplate('{project}_{shot}_{version}', c),
    );
  });
});
