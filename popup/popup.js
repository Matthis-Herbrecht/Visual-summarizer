// Visual Summarizer Popup Script - Secured Version
'use strict';

document.addEventListener('DOMContentLoaded', async () => {
  const elements = {
    apiKey: document.getElementById('api-key'),
    toggleVisibility: document.getElementById('toggle-visibility'),
    saveKey: document.getElementById('save-key'),
    status: document.getElementById('status-message'),
    openSummarizer: document.getElementById('open-summarizer'),
    modeRadios: document.querySelectorAll('input[name="mode"]'),
    langRadios: document.querySelectorAll('input[name="lang"]'),
    savedSection: document.getElementById('saved-section'),
    savedList: document.getElementById('saved-list')
  };

  // Validate API key format
  function isValidApiKey(key) {
    return typeof key === 'string' &&
           key.length > 20 &&
           key.startsWith('sk-ant-');
  }

  // Show status message
  function showStatus(message, type) {
    elements.status.textContent = message;
    elements.status.className = `status ${type}`;
    if (type === 'success') {
      setTimeout(() => {
        elements.status.textContent = '';
        elements.status.className = 'status';
      }, 3000);
    }
  }

  // Load saved settings
  try {
    const { apiKey, defaultMode, language, savedPoints } = await chrome.storage.local.get(['apiKey', 'defaultMode', 'language', 'savedPoints']);

    if (apiKey) {
      elements.apiKey.value = apiKey;
      showStatus('API key loaded', 'success');
    }

    if (defaultMode) {
      const radio = document.querySelector(`input[name="mode"][value="${defaultMode}"]`);
      if (radio) radio.checked = true;
    }

    if (language) {
      const radio = document.querySelector(`input[name="lang"][value="${language}"]`);
      if (radio) radio.checked = true;
    }

    // Load saved points
    renderSavedPoints(savedPoints || []);
  } catch {}

  // Toggle password visibility
  elements.toggleVisibility.addEventListener('click', () => {
    const isPassword = elements.apiKey.type === 'password';
    elements.apiKey.type = isPassword ? 'text' : 'password';
    elements.toggleVisibility.textContent = isPassword ? '🙈' : '👁️';
  });

  // Save API key
  elements.saveKey.addEventListener('click', async () => {
    const apiKey = elements.apiKey.value.trim();

    if (!apiKey) {
      showStatus('Please enter an API key', 'error');
      return;
    }

    if (!isValidApiKey(apiKey)) {
      showStatus('Invalid API key format', 'error');
      return;
    }

    try {
      await chrome.storage.local.set({ apiKey });
      showStatus('API key saved', 'success');
    } catch {
      showStatus('Failed to save', 'error');
    }
  });

  // Mode selection
  elements.modeRadios.forEach(radio => {
    radio.addEventListener('change', async (e) => {
      const mode = e.target.value;
      if (['takeaways', 'visual'].includes(mode)) {
        await chrome.storage.local.set({ defaultMode: mode });
      }
    });
  });

  // Language selection
  elements.langRadios.forEach(radio => {
    radio.addEventListener('change', async (e) => {
      const lang = e.target.value;
      if (['en', 'fr'].includes(lang)) {
        await chrome.storage.local.set({ language: lang });
      }
    });
  });

  // Render saved points
  function renderSavedPoints(points) {
    if (!elements.savedList) return;
    elements.savedList.innerHTML = '';

    if (points.length === 0) {
      elements.savedList.innerHTML = '<p class="empty-saved">No saved points yet</p>';
      return;
    }

    points.forEach((point, index) => {
      const item = document.createElement('div');
      item.className = 'saved-item';

      const text = document.createElement('span');
      text.className = 'saved-text';
      text.textContent = point.text;

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'delete-btn';
      deleteBtn.textContent = '×';
      deleteBtn.addEventListener('click', async () => {
        const { savedPoints } = await chrome.storage.local.get(['savedPoints']);
        const updated = (savedPoints || []).filter((_, i) => i !== index);
        await chrome.storage.local.set({ savedPoints: updated });
        renderSavedPoints(updated);
      });

      item.appendChild(text);
      item.appendChild(deleteBtn);
      elements.savedList.appendChild(item);
    });
  }

  // Listen for storage changes to update saved points
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.savedPoints) {
      renderSavedPoints(changes.savedPoints.newValue || []);
    }
  });

  // Open summarizer
  elements.openSummarizer.addEventListener('click', async () => {
    const { apiKey } = await chrome.storage.local.get(['apiKey']);

    if (!apiKey) {
      showStatus('Save your API key first', 'error');
      return;
    }

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return;

      try {
        await chrome.tabs.sendMessage(tab.id, { action: 'togglePanel' });
      } catch {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content/content.js']
        });
        await chrome.scripting.insertCSS({
          target: { tabId: tab.id },
          files: ['content/content.css']
        });
        setTimeout(async () => {
          await chrome.tabs.sendMessage(tab.id, { action: 'togglePanel' });
        }, 100);
      }
      window.close();
    } catch {
      showStatus('Cannot run on this page', 'error');
    }
  });
});
