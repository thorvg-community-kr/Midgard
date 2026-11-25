import { afterEach, describe, expect, it } from 'vitest';
import manifest from '../../packages/native-audio/src/data/audio-manifest.json';
import { hasHangul, locale, setLocale, translate } from '../../packages/localization/src/index';
import { captionShown } from '../../apps/web/src/native/game-speech';
import { PersonSpeech } from '../../packages/native-audio/src/person-speech';
import { VoiceKind, VoiceLine } from '../../packages/native-audio/src/sound-types';
import { voiceTakes } from '../../packages/native-audio/src/spoken-voice';
import { Calling, Person, Race, Role } from '../../packages/engine/src/person';
import { Mood } from '../../packages/engine/src/person-look';
import { point } from '../../packages/engine/src/geometry';

const captions = (value: unknown, found = new Set<string>()): Set<string> => {
  if (Array.isArray(value)) for (const item of value) captions(item, found);
  else if (value && typeof value === 'object')
    for (const [key, item] of Object.entries(value))
      if (key === 'caption' && typeof item === 'string' && item) found.add(item);
      else captions(item, found);
  return found;
};

it('keeps the missing-hammer remark out of every voice and gives idle settlers a quiet interval', () => {
  const speech = new PersonSpeech();
  for (let voice = 0; voice < VoiceKind.Count; ++voice) {
    expect(voiceTakes(VoiceLine.Mumble, voice)).toBe(0);
    expect(speech.say(VoiceLine.Mumble, 0, 1, voice)).toBe(false);
  }
  const settler = new Person(0, 'Bryn', Role.Resident, Calling.Settler, Race.Human, 0, point());
  speech.update(settler, Mood.Content, 0);
  // This resident draws a quiet interval at 20 and speaks at 40.
  speech.update(settler, Mood.Content, 20);
  speech.update(settler, Mood.Content, 21);
  expect(speech.sequence()).toBe(0n);
  expect(speech.caption(21)).toBe('');
  speech.update(settler, Mood.Content, 40);
  expect(speech.sequence()).toBe(1n);
  expect([VoiceLine.Hmm, VoiceLine.Ahh]).toContain(speech.voice());
});

describe('speech bubbles in Korean', () => {
  const before = locale();
  afterEach(() => setLocale(before));
  it('has a Korean line for every recorded voice caption', () => {
    setLocale('KR');
    for (const caption of captions(manifest)) expect(hasHangul(translate(caption)), caption).toBe(true);
  });
  it('shows the spoken share of the translated line, not the untranslated beginning of the English one', () => {
    setLocale('KR');
    const line = 'Uhk! ... Ak! ... Ut! ... Nk!',
      whole = translate(line);
    expect(captionShown(line, line)).toBe(whole);
    const half = captionShown(line.slice(0, 12), line);
    expect(hasHangul(half)).toBe(true);
    expect(whole.startsWith(half)).toBe(true);
    expect(half.length).toBeLessThan(whole.length);
    // A single spoken letter still shows something.
    expect(captionShown('Y', 'Yes?').length).toBeGreaterThan(0);
  });
  it('leaves English as it is spoken', () => {
    setLocale('ENG');
    expect(captionShown('Ye', 'Yes?')).toBe('Ye');
  });
});
