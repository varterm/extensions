// Varterm TTS Chrome Extension - Popup Script

const SPEED_PRESETS = [0.75, 1, 1.25, 1.5, 2];

document.addEventListener('DOMContentLoaded', () => {
  const voiceTierSelect = document.getElementById('voiceTier');
  const voiceSelect = document.getElementById('voice');
  const voiceGroup = document.getElementById('voiceGroup');
  const rateSlider = document.getElementById('rate');
  const rateValue = document.getElementById('rateValue');
  const speedChips = document.getElementById('speedChips');
  const stripMarkdown = document.getElementById('stripMarkdown');
  const autoReadList = document.getElementById('autoReadList');
  const autoReadHint = document.getElementById('autoReadHint');
  const readSelectionBtn = document.getElementById('readSelection');
  const readYouTubeBtn = document.getElementById('readYouTube');
  const youtubeHint = document.getElementById('youtubeHint');
  const readChatBtn = document.getElementById('readChat');
  const jumpBackBtn = document.getElementById('jumpBack');
  const jumpForwardBtn = document.getElementById('jumpForward');
  const pauseBtn = document.getElementById('pause');
  const stopBtn = document.getElementById('stop');
  const status = document.getElementById('status');

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const url = tabs[0]?.url || '';
    if (/^https:\/\/(www\.|m\.)?youtube\.com\/watch\?/.test(url)) {
      readYouTubeBtn.style.display = '';
      youtubeHint.style.display = '';
    }
    if (typeof vartermSiteForUrl === 'function' && vartermSiteForUrl(url)) {
      readChatBtn.style.display = '';
    }
  });

  for (const voice of VARTERM_VOICES) {
    const option = document.createElement('option');
    option.value = voice.id;
    option.textContent = vartermVoiceLabel(voice);
    voiceSelect.appendChild(option);
  }

  for (const rate of SPEED_PRESETS) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'speed-chip';
    chip.dataset.rate = String(rate);
    chip.textContent = `${rate}×`;
    chip.addEventListener('click', () => {
      rateSlider.value = String(rate);
      rateValue.textContent = rate.toFixed(1);
      paintSpeedChips();
      saveSettings(true);
    });
    speedChips.appendChild(chip);
  }

  function paintSpeedChips() {
    const current = parseFloat(rateSlider.value);
    for (const chip of speedChips.querySelectorAll('.speed-chip')) {
      chip.classList.toggle('active', Math.abs(parseFloat(chip.dataset.rate) - current) < 0.05);
    }
  }

  const autoReadBoxes = {};
  for (const site of VARTERM_CHAT_SITES) {
    const row = document.createElement('div');
    row.className = 'checkbox-group';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.id = site.storageKey;
    const label = document.createElement('label');
    label.htmlFor = site.storageKey;
    label.textContent = site.name;
    row.appendChild(box);
    row.appendChild(label);
    autoReadList.appendChild(row);
    autoReadBoxes[site.id] = box;
    box.addEventListener('change', () => toggleAutoRead(site, box));
  }

  chrome.runtime.sendMessage({ action: 'getSettings' }, (settings) => {
    voiceTierSelect.value = settings.voiceTier || 'cloud';
    voiceSelect.value = vartermNormalizeVoice(settings.voice);
    rateSlider.value = settings.rate || 1.0;
    rateValue.textContent = Number(settings.rate || 1).toFixed(1);
    stripMarkdown.checked = settings.stripMarkdown !== false;
    paintSpeedChips();
    updateVoiceGroupVisibility();

    for (const site of VARTERM_CHAT_SITES) {
      if (autoReadBoxes[site.id]) {
        autoReadBoxes[site.id].checked = !!settings[site.storageKey];
      }
    }
  });

  function toggleAutoRead(site, box) {
    const enable = box.checked;

    const apply = (granted) => {
      chrome.runtime.sendMessage(
        { action: 'setChatAutoRead', site: site.id, enabled: enable, granted: !!granted },
        (response) => {
          if (chrome.runtime.lastError || !response?.success) {
            box.checked = false;
            autoReadHint.textContent =
              `Needs access to ${site.name}. Allow it in chrome://extensions → Varterm → Site access, then tick this again.`;
            return;
          }
          autoReadHint.textContent = enable
            ? `Reading replies on ${site.name}. Reload any open tab.`
            : 'Asks Chrome for that site the first time. If the popup closes, allow it under Site access, then tick again.';
        }
      );
    };

    if (!enable) {
      apply(false);
      return;
    }

    chrome.permissions.request({ origins: site.origins }, (granted) => {
      if (granted) {
        apply(true);
        return;
      }
      chrome.permissions.contains({ origins: site.origins }, (already) => {
        if (already) {
          apply(true);
          return;
        }
        box.checked = false;
        autoReadHint.textContent =
          `Chrome did not grant ${site.name}. Allow the site under the extension’s Site access, then tick this again.`;
      });
    });
  }

  voiceTierSelect.addEventListener('change', () => {
    updateVoiceGroupVisibility();
    saveSettings(true);
  });

  function updateVoiceGroupVisibility() {
    voiceGroup.style.display = voiceTierSelect.value === 'cloud' ? 'block' : 'none';
  }

  voiceSelect.addEventListener('change', () => saveSettings(true));

  rateSlider.addEventListener('input', () => {
    rateValue.textContent = parseFloat(rateSlider.value).toFixed(1);
    paintSpeedChips();
  });

  rateSlider.addEventListener('change', () => saveSettings(true));
  stripMarkdown.addEventListener('change', () => saveSettings(false));

  function saveSettings(replay) {
    const settings = {
      voiceTier: voiceTierSelect.value,
      voice: voiceSelect.value,
      rate: parseFloat(rateSlider.value),
      stripMarkdown: stripMarkdown.checked
    };

    chrome.runtime.sendMessage({ action: 'saveSettings', settings }, () => {
      showStatus('Settings saved', 'success');

      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, {
            action: 'updateSettings',
            settings,
            replay: !!replay
          }, () => {
            void chrome.runtime.lastError;
          });
        }
      });
    });
  }

  // The popup opens under the toolbar icon, which is exactly where the reader
  // panel sits. Once a button has done its job the popup is in the way, so it
  // closes itself and leaves the panel visible. Transport stays open so you
  // can jump more than once. Errors keep it open, since there is something to
  // read.
  function runTabAction(tabAction, busyMessage, failMessage, keepOpen) {
    chrome.runtime.sendMessage({ action: 'performTabAction', tabAction }, (response) => {
      if (!response?.success) {
        showStatus(response?.error || failMessage, 'error');
        return;
      }
      if (busyMessage) showStatus(busyMessage, 'success');
      if (!keepOpen) window.close();
    });
  }

  readSelectionBtn.addEventListener('click', () => {
    runTabAction('speakSelection', 'Reading selection...', 'Cannot access this page');
  });

  readYouTubeBtn.addEventListener('click', () => {
    runTabAction('speakYouTube', 'Reading transcript...', 'Cannot read this video');
  });

  readChatBtn.addEventListener('click', () => {
    runTabAction('speakChat', 'Reading reply...', 'No reply to read');
  });

  jumpBackBtn.addEventListener('click', () => {
    runTabAction('stepBack', null, 'Nothing is playing', true);
  });

  jumpForwardBtn.addEventListener('click', () => {
    runTabAction('stepForward', null, 'Nothing is playing', true);
  });

  pauseBtn.addEventListener('click', () => {
    runTabAction('pause', null, 'Nothing is playing', true);
  });

  stopBtn.addEventListener('click', () => {
    runTabAction('stop', null, 'Cannot stop on this page');
  });

  function showStatus(message, type) {
    status.textContent = message;
    status.className = `status ${type}`;
    setTimeout(() => {
      status.className = 'status';
    }, 2000);
  }
});
