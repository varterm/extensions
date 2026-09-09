// Turning a written reply into something worth listening to.
//
// Ported from the editor extension so one voice reads the same text the same
// way everywhere: stripForSpeech and splitTextIntoChunks in
// extensions/vscode/src/auto-read.ts and extension.ts.

// Code blocks are dropped rather than spoken. Listening to punctuation and
// brackets is not useful, and a long block would bury the prose around it.
export function stripForSpeech(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Synthesis is per request, so long text is split. Breaking at a sentence
// rather than a character count keeps the seam between two clips inaudible.
export function splitTextIntoChunks(text, maxChars = 450) {
  const normalized = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const paragraphs = normalized.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  const chunks = [];

  const pushSized = (block) => {
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
      if (piece) chunks.push(piece);
      start += Math.max(1, slice.length);
    }
  };

  let current = '';
  for (const para of paragraphs) {
    if (!current) {
      current = para;
      continue;
    }
    // Short paragraphs are merged so the voice does not pause every line.
    if (current.length + 2 + para.length <= 180) {
      current = `${current}\n\n${para}`;
      continue;
    }
    pushSized(current);
    current = para;
  }
  if (current) pushSized(current);

  return chunks;
}
