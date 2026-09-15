#!/usr/bin/env node
// The command line behind /varterm:on, :off, :voice, :stop and :status.
//
// The slash commands are markdown that ask Claude to run this, because a
// command cannot change settings by itself. Everything it prints is meant to be
// read back to you as-is.

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readConfig, writeConfig, configPath } from './lib/config.mjs';
import { currentOwner, stopOwner } from './lib/lock.mjs';
import { findPlayer } from './lib/speech.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const [command, ...rest] = process.argv.slice(2);
const value = rest.join(' ').trim();

function say(text) {
  const child = spawn(process.execPath, [join(HERE, 'play.mjs')], {
    detached: true,
    stdio: ['pipe', 'ignore', 'ignore'],
  });
  child.stdin.end(text);
  child.unref();
}

switch (command) {
  case 'on': {
    writeConfig({ enabled: true });
    console.log('Reading replies aloud.');
    if (!findPlayer()) {
      console.log(
        'No audio player found, so nothing will actually play. Install ffmpeg for ffplay, or one of mpv, mpg123, VLC, or SoX.'
      );
    }
    break;
  }

  case 'off': {
    writeConfig({ enabled: false });
    stopOwner();
    console.log('Not reading replies aloud any more.');
    break;
  }

  case 'stop': {
    console.log(stopOwner() ? 'Stopped.' : 'Nothing was being read.');
    break;
  }

  case 'voice': {
    if (!value) {
      console.log(`Current voice: ${readConfig().voice}`);
      console.log('Pass a Microsoft neural voice id, for example en-GB-RyanNeural.');
      console.log('The full list is at https://varterm.com.');
      break;
    }
    if (!/^[a-z]{2,3}-[A-Za-z]+-[A-Za-z]+$/.test(value)) {
      console.log(`"${value}" is not a voice id. They look like en-US-EmmaNeural.`);
      break;
    }
    writeConfig({ voice: value });
    console.log(`Voice set to ${value}.`);
    say('This is how replies will sound.');
    break;
  }

  case 'rate': {
    const rate = Number(value);
    if (!Number.isFinite(rate) || rate < 0.5 || rate > 2) {
      console.log(`Rate must be between 0.5 and 2. Currently ${readConfig().rate}.`);
      break;
    }
    writeConfig({ rate });
    console.log(`Speaking rate set to ${rate}.`);
    break;
  }

  case 'notify': {
    const on = value !== 'off';
    writeConfig({ notify: on });
    console.log(on
      ? 'Will say when Claude is waiting on you.'
      : 'Will stay quiet when Claude is waiting on you.');
    break;
  }

  case 'status':
  default: {
    const config = readConfig();
    const player = findPlayer();
    const owner = currentOwner();
    console.log(`Reading replies: ${config.enabled ? 'on' : 'off'}`);
    console.log(`Voice: ${config.voice}`);
    console.log(`Rate: ${config.rate}`);
    console.log(`Skips replies over: ${config.maxChars} characters`);
    console.log(`Waiting-on-you announcements: ${config.notify ? 'on' : 'off'}`);
    console.log(`Audio player: ${player ? player.cmd : 'none found'}`);
    console.log(`Speaking right now: ${owner ? `yes (pid ${owner.pid})` : 'no'}`);
    console.log(`Settings file: ${configPath()}`);
    break;
  }
}
