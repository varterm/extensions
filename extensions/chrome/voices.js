// Varterm TTS Chrome Extension - Voice catalog
//
// Shared by the popup and the reader panel so the two can never drift apart.
// Loaded as a plain script in the popup and injected alongside the content
// script, so no top-level const/let here either.

var VARTERM_VOICES = [
  { id: 'en-US-AriaNeural', name: 'Aria', desc: 'US, friendly' },
  { id: 'en-US-JennyNeural', name: 'Jenny', desc: 'US, warm' },
  { id: 'en-US-GuyNeural', name: 'Guy', desc: 'US, casual' },
  { id: 'en-US-AndrewNeural', name: 'Andrew', desc: 'US, calm' },
  { id: 'en-GB-SoniaNeural', name: 'Sonia', desc: 'UK, warm' },
  { id: 'en-GB-RyanNeural', name: 'Ryan', desc: 'UK, professional' },
  { id: 'en-AU-NatashaNeural', name: 'Natasha', desc: 'AU, friendly' }
];

var VARTERM_DEFAULT_VOICE = 'en-US-AriaNeural';

// Microsoft retires voice names, and a saved preference outlives them. The API
// still answers to the old ids, but the picker would show nothing selected, so
// old ids are mapped to what actually plays.
var VARTERM_VOICE_ALIASES = {
  'en-US-DavisNeural': 'en-US-AndrewNeural',
  'en-US-TonyNeural': 'en-US-ChristopherNeural',
  'en-US-SaraNeural': 'en-US-EmmaNeural'
};

function vartermNormalizeVoice(id) {
  const mapped = VARTERM_VOICE_ALIASES[id] || id;
  return VARTERM_VOICES.some((v) => v.id === mapped) ? mapped : VARTERM_DEFAULT_VOICE;
}

function vartermVoiceLabel(voice) {
  return `${voice.name} (${voice.desc})`;
}
