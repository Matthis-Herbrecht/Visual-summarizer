// Visual Summarizer Background Script - Secured Version
'use strict';

const CONFIG = Object.freeze({
  API_URL: 'https://api.anthropic.com/v1/messages',
  MODEL: 'claude-3-5-haiku-20241022',
  MAX_TOKENS: 2048,
  MAX_TEXT_LENGTH: 15000,
  ALLOWED_MODES: ['takeaways', 'visual'],
  ALLOWED_ACTIONS: ['callClaudeAPI', 'getSettings', 'expandPoint']
});

const PROMPTS = {
  takeaways: {
    en: `Summarize the following text into a clear, structured summary. Be concise and direct.

Format your response EXACTLY as follows:

## SUMMARY
[2-3 sentences explaining what this is about]

## KEY POINTS
- [Point 1]
- [Point 2]
- [Point 3]
- [Point 4]
- [Point 5]
[Add more if needed, max 7 points]

## STATS & DATA
- [Any number, percentage, statistic or quantifiable data mentioned]
- [Another data point]
[If no stats/data in the text, write "No specific data mentioned"]

Text to summarize:
`,
    fr: `Résume le texte suivant de manière claire et structurée. Sois concis et direct.

Formate ta réponse EXACTEMENT comme suit:

## SUMMARY
[2-3 phrases expliquant le sujet]

## KEY POINTS
- [Point 1]
- [Point 2]
- [Point 3]
- [Point 4]
- [Point 5]
[Ajoute plus si nécessaire, max 7 points]

## STATS & DATA
- [Tout chiffre, pourcentage, statistique ou donnée mentionnée]
- [Autre donnée]
[Si pas de stats/données, écris "Aucune donnée spécifique mentionnée"]

Texte à résumer:
`
  },

  visual: {
    en: `Analyze this text and create a visual mind map structure.

Format your response EXACTLY as follows:

## MINDMAP
\`\`\`mindmap
Main Topic
  Category 1
    - Point A
    - Point B
  Category 2
    - Point C
    - Point D
  Category 3
    - Point E
\`\`\`

## STRUCTURE
\`\`\`structure
Main Topic
├─ Category 1
│  ├─ Point A
│  └─ Point B
├─ Category 2
│  ├─ Point C
│  └─ Point D
└─ Category 3
   └─ Point E
\`\`\`

Rules:
- Main topic is the central idea
- 3-5 categories branching from main topic
- 2-4 points per category
- Keep text SHORT (max 5 words per item)

Text:
`,
    fr: `Analyse ce texte et crée une structure de mind map visuelle.

Formate ta réponse EXACTEMENT comme suit:

## MINDMAP
\`\`\`mindmap
Sujet Principal
  Catégorie 1
    - Point A
    - Point B
  Catégorie 2
    - Point C
    - Point D
  Catégorie 3
    - Point E
\`\`\`

## STRUCTURE
\`\`\`structure
Sujet Principal
├─ Catégorie 1
│  ├─ Point A
│  └─ Point B
├─ Catégorie 2
│  ├─ Point C
│  └─ Point D
└─ Catégorie 3
   └─ Point E
\`\`\`

Règles:
- Le sujet principal est l'idée centrale
- 3-5 catégories partant du sujet principal
- 2-4 points par catégorie
- Texte COURT (max 5 mots par élément)

Texte:
`
  }
};

// Validate API key format
function isValidApiKey(key) {
  return typeof key === 'string' &&
         key.length > 20 &&
         key.startsWith('sk-ant-');
}

// Validate text input
function sanitizeText(text) {
  if (typeof text !== 'string') return '';
  return text.slice(0, CONFIG.MAX_TEXT_LENGTH);
}

// Handle keyboard shortcut
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-summarizer') return;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    const { apiKey } = await chrome.storage.local.get(['apiKey']);
    if (!apiKey) {
      chrome.action.openPopup();
      return;
    }

    try {
      await chrome.tabs.sendMessage(tab.id, { action: 'togglePanel' });
    } catch {
      await injectContentScript(tab.id);
      setTimeout(() => {
        chrome.tabs.sendMessage(tab.id, { action: 'togglePanel' }).catch(() => {});
      }, 150);
    }
  } catch {}
});

// Inject content script
async function injectContentScript(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content/content.js']
  });
  await chrome.scripting.insertCSS({
    target: { tabId },
    files: ['content/content.css']
  });
}

// Message handler with validation
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Only accept messages from extension context
  if (!sender.id || sender.id !== chrome.runtime.id) {
    return false;
  }

  const { action } = request;

  if (action === 'callClaudeAPI') {
    handleApiCall(request)
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (action === 'getSettings') {
    chrome.storage.local.get(['apiKey', 'defaultMode'])
      .then(settings => {
        // Never expose full API key
        sendResponse({
          apiKey: settings.apiKey ? true : false,
          defaultMode: settings.defaultMode
        });
      })
      .catch(() => sendResponse({ apiKey: false }));
    return true;
  }

  if (action === 'expandPoint') {
    handleExpandPoint(request.point)
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  return false;
});

// Secure API call handler
async function handleApiCall(request) {
  const { text, mode } = request;

  // Validate mode
  if (!CONFIG.ALLOWED_MODES.includes(mode)) {
    throw new Error('Invalid mode');
  }

  // Get API key and language from storage
  const { apiKey, language } = await chrome.storage.local.get(['apiKey', 'language']);
  if (!isValidApiKey(apiKey)) {
    throw new Error('Invalid API key');
  }

  const lang = language || 'en';

  // Sanitize text
  const sanitizedText = sanitizeText(text);
  if (sanitizedText.length < 50) {
    throw new Error('Text too short');
  }

  const prompt = PROMPTS[mode][lang] + sanitizedText;

  const response = await fetch(CONFIG.API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: CONFIG.MODEL,
      max_tokens: CONFIG.MAX_TOKENS,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error?.message || 'API request failed');
  }

  const data = await response.json();

  if (!data.content?.[0]?.text) {
    throw new Error('Invalid API response');
  }

  return data.content[0].text;
}

// Handle expand point request
async function handleExpandPoint(point) {
  if (typeof point !== 'string' || point.length < 5) {
    throw new Error('Invalid point');
  }

  const { apiKey, language } = await chrome.storage.local.get(['apiKey', 'language']);
  if (!isValidApiKey(apiKey)) {
    throw new Error('Invalid API key');
  }

  const lang = language || 'en';
  const prompt = lang === 'fr'
    ? `Explique ce point en 2-3 phrases avec un exemple concret: "${point.slice(0, 500)}"`
    : `Explain this point in 2-3 sentences with a concrete example: "${point.slice(0, 500)}"`;

  const response = await fetch(CONFIG.API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: CONFIG.MODEL,
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) {
    throw new Error('API request failed');
  }

  const data = await response.json();
  if (!data.content?.[0]?.text) {
    throw new Error('Invalid response');
  }

  return data.content[0].text;
}
