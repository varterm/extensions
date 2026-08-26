// Frame-level MP3 trimming, used to resume playback part-way through a chunk.
//
// afplay has no seek flag and cannot be paused (suspending it does not stop
// CoreAudio, it just drops audio), so pause kills the player and resume plays a
// trimmed copy of the remainder. MP3 is a flat sequence of self-describing
// frames, so the remainder can be produced by dropping whole frames off the
// front without decoding anything.
//
// Cutting mid-stream can clip the bit reservoir and smear the first frame or
// two after the join, which is well under the rewind the caller applies.

const BITRATES_KBPS_MPEG1_LAYER3 = [
  0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0,
];
const BITRATES_KBPS_MPEG2_LAYER3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];

// Keyed by the header's two version bits: 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5.
const SAMPLE_RATES: Record<number, number[]> = {
  3: [44100, 48000, 32000, 0],
  2: [22050, 24000, 16000, 0],
  0: [11025, 12000, 8000, 0],
};

const LAYER_3 = 1;

type Frame = { length: number; durationMs: number };

// Length of the leading ID3v2 tag, if any. Its size field is synchsafe: seven
// bits per byte, high bit always clear.
function id3v2Length(data: Buffer): number {
  if (data.length < 10 || data.toString('latin1', 0, 3) !== 'ID3') {
    return 0;
  }
  const size =
    (data[6] & 0x7f) * 0x200000 +
    (data[7] & 0x7f) * 0x4000 +
    (data[8] & 0x7f) * 0x80 +
    (data[9] & 0x7f);
  return 10 + size;
}

function readFrame(data: Buffer, offset: number): Frame | undefined {
  if (offset + 4 > data.length) {
    return undefined;
  }
  if (data[offset] !== 0xff || (data[offset + 1] & 0xe0) !== 0xe0) {
    return undefined;
  }

  const versionBits = (data[offset + 1] >> 3) & 0x03;
  const layerBits = (data[offset + 1] >> 1) & 0x03;
  if (versionBits === 1 || layerBits !== LAYER_3) {
    return undefined;
  }

  const bitrateIndex = (data[offset + 2] >> 4) & 0x0f;
  const sampleRateIndex = (data[offset + 2] >> 2) & 0x03;
  const padding = (data[offset + 2] >> 1) & 0x01;

  const isMpeg1 = versionBits === 3;
  const bitrateKbps = isMpeg1
    ? BITRATES_KBPS_MPEG1_LAYER3[bitrateIndex]
    : BITRATES_KBPS_MPEG2_LAYER3[bitrateIndex];
  const sampleRate = SAMPLE_RATES[versionBits]?.[sampleRateIndex] ?? 0;
  if (!bitrateKbps || !sampleRate) {
    return undefined;
  }

  const samplesPerFrame = isMpeg1 ? 1152 : 576;
  const length = Math.floor((samplesPerFrame / 8) * ((bitrateKbps * 1000) / sampleRate)) + padding;
  if (length < 4) {
    return undefined;
  }

  return { length, durationMs: (samplesPerFrame / sampleRate) * 1000 };
}

// Next plausible frame start at or after `from`, for recovering from junk
// between frames rather than giving up on the whole file.
function findSync(data: Buffer, from: number): number {
  for (let offset = from; offset + 1 < data.length; offset += 1) {
    if (data[offset] === 0xff && (data[offset + 1] & 0xe0) === 0xe0) {
      return offset;
    }
  }
  return -1;
}

function walk(data: Buffer, onFrame: (offset: number, frame: Frame, elapsedMs: number) => boolean): void {
  let offset = id3v2Length(data);
  let elapsedMs = 0;

  while (offset < data.length) {
    const frame = readFrame(data, offset);
    if (!frame) {
      const next = findSync(data, offset + 1);
      if (next < 0) {
        return;
      }
      offset = next;
      continue;
    }
    if (onFrame(offset, frame, elapsedMs)) {
      return;
    }
    elapsedMs += frame.durationMs;
    offset += frame.length;
  }
}

export function mp3DurationMs(data: Buffer): number {
  let total = 0;
  walk(data, (_offset, frame) => {
    total += frame.durationMs;
    return false;
  });
  return total;
}

/**
 * Everything from the first frame that is still playing at `startMs`. Returns
 * the buffer unchanged when `startMs` lands before the first frame, and an
 * empty buffer when it lands past the end. Unparseable input is returned as-is
 * so a bad trim degrades to replaying the chunk rather than failing.
 */
export function sliceMp3FromMs(data: Buffer, startMs: number): Buffer {
  if (startMs <= 0) {
    return data;
  }

  let cutAt = -1;
  let sawFrame = false;
  walk(data, (offset, frame, elapsedMs) => {
    sawFrame = true;
    if (elapsedMs + frame.durationMs > startMs) {
      cutAt = offset;
      return true;
    }
    return false;
  });

  if (!sawFrame) {
    return data;
  }
  if (cutAt < 0) {
    return Buffer.alloc(0);
  }
  return data.subarray(cutAt);
}
