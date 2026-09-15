// Turning written text into something a voice service will actually speak.
//
// Kept apart from extension.ts because none of it touches the editor, which
// means it can be tested directly. See tests/speech-text.test.mjs.

export function splitTextIntoChunks(text: string, maxChars: number): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return [];
  }

  const paragraphs = normalized.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  const chunks: string[] = [];

  const pushSized = (block: string) => {
    if (block.length <= maxChars) {
      chunks.push(block);
      return;
    }
    let start = 0;
    while (start < block.length) {
      const end = Math.min(start + maxChars, block.length);
      let slice = block.slice(start, end);
      if (end < block.length) {
        const breakIndex = Math.max(
          slice.lastIndexOf('. '),
          slice.lastIndexOf('? '),
          slice.lastIndexOf('! '),
          slice.lastIndexOf('\n'),
          slice.lastIndexOf(' ')
        );
        if (breakIndex > Math.floor(maxChars * 0.35)) {
          slice = slice.slice(0, breakIndex + 1);
        }
      }
      const piece = slice.trim();
      if (piece) {
        chunks.push(piece);
      }
      start += Math.max(1, slice.length);
    }
  };

  let current = '';
  for (const para of paragraphs) {
    if (!current) {
      current = para;
      continue;
    }
    if (current.length + 2 + para.length <= 180) {
      current = `${current}\n\n${para}`;
      continue;
    }
    pushSized(current);
    current = para;
  }
  if (current) {
    pushSized(current);
  }

  // A chunk of pure punctuation has nothing to say, and the voice service
  // answers one with zero bytes rather than silence, which surfaces as a failed
  // read. A markdown rule between two long paragraphs lands here: it is too
  // long to merge with either neighbour, so it becomes a chunk of its own.
  return chunks.filter(hasSpeakableText);
}

// Digits count: "42" is read aloud as a word.
export function hasSpeakableText(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}

// Microsoft's voices are locale specific in a way that fails silently. Give an
// English voice a page of Chinese, Cyrillic, Arabic, or Devanagari and it
// returns zero bytes rather than an error, which reaches the user as "no audio
// generated" - a message that blames their text when the voice is the problem.
// A few foreign words mixed into English are fine, so this only fires when the
// other script is most of what is there.
const VOICE_SCRIPTS: Array<{ name: string; pattern: RegExp; langs: string[]; example: string }> = [
  // Japanese before Chinese: Japanese text contains Han characters too.
  { name: 'Japanese', pattern: /[\p{Script=Hiragana}\p{Script=Katakana}]/u, langs: ['ja'], example: 'ja-JP-NanamiNeural' },
  { name: 'Chinese', pattern: /\p{Script=Han}/u, langs: ['zh', 'ja'], example: 'zh-CN-XiaoxiaoNeural' },
  { name: 'Korean', pattern: /\p{Script=Hangul}/u, langs: ['ko'], example: 'ko-KR-SunHiNeural' },
  { name: 'Cyrillic', pattern: /\p{Script=Cyrillic}/u, langs: ['ru', 'uk', 'bg', 'sr', 'kk'], example: 'ru-RU-SvetlanaNeural' },
  { name: 'Arabic', pattern: /\p{Script=Arabic}/u, langs: ['ar', 'fa', 'ur'], example: 'ar-SA-ZariyahNeural' },
  { name: 'Devanagari', pattern: /\p{Script=Devanagari}/u, langs: ['hi', 'mr', 'ne'], example: 'hi-IN-SwaraNeural' },
  { name: 'Hebrew', pattern: /\p{Script=Hebrew}/u, langs: ['he'], example: 'he-IL-HilaNeural' },
  { name: 'Thai', pattern: /\p{Script=Thai}/u, langs: ['th'], example: 'th-TH-PremwadeeNeural' },
  { name: 'Greek', pattern: /\p{Script=Greek}/u, langs: ['el'], example: 'el-GR-AthinaNeural' },
];

// Latin text reports as 'Latin' and anything too short to judge as 'unknown',
// so this is safe to attach to an error report as a tag.
export function dominantScript(text: string): string {
  const letters = text.match(/\p{L}/gu) || [];
  if (letters.length < 4) {
    return 'unknown';
  }
  const script = VOICE_SCRIPTS.find(
    (candidate) =>
      letters.filter((letter) => candidate.pattern.test(letter)).length / letters.length >= 0.5
  );
  return script ? script.name : 'Latin';
}

export function voiceCannotSpeak(text: string, voiceId: string): string | undefined {
  const script = VOICE_SCRIPTS.find((candidate) => candidate.name === dominantScript(text));
  if (!script) {
    return undefined;
  }
  if (script.langs.includes((voiceId.split('-')[0] || '').toLowerCase())) {
    return undefined;
  }
  return (
    `The ${voiceId} voice cannot speak ${script.name} text, so nothing was generated. ` +
    `Set vartermCursor.readAloudVoice to a matching voice, for example ${script.example}.`
  );
}
