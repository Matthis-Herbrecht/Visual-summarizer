// Visual Summarizer Content Script - Secured Version
(function () {
  'use strict';

  const CONFIG = Object.freeze({
    PANEL_ID: 'visual-summarizer-panel',
    MIN_TEXT_LENGTH: 50,
    MAX_TEXT_LENGTH: 15000
  });

  let panel = null;
  let currentMode = 'takeaways';
  let isLoading = false;

  // Secure HTML sanitization
  function sanitize(str) {
    if (typeof str !== 'string') return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Create element safely
  function createElement(tag, attributes = {}, textContent = '') {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(attributes)) {
      if (key === 'className') {
        el.className = value;
      } else if (key === 'dataset') {
        for (const [dataKey, dataValue] of Object.entries(value)) {
          el.dataset[dataKey] = dataValue;
        }
      } else {
        el.setAttribute(key, value);
      }
    }
    if (textContent) el.textContent = textContent;
    return el;
  }

  // Message listener with validation
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Validate sender is from extension
    if (!sender.id || sender.id !== chrome.runtime.id) {
      return false;
    }

    if (request?.action === 'togglePanel') {
      togglePanel();
      sendResponse({ success: true });
    }
    return true;
  });

  function togglePanel() {
    if (panel && document.contains(panel)) {
      panel.classList.toggle('vs-visible');
      document.body.style.marginRight = panel.classList.contains('vs-visible') ? '450px' : '0';
    } else {
      createPanel();
    }
  }

  function createPanel() {
    // Remove existing panel if any
    const existing = document.getElementById(CONFIG.PANEL_ID);
    if (existing) existing.remove();

    panel = createElement('div', { id: CONFIG.PANEL_ID, className: 'vs-visible' });

    // Header
    const header = createElement('div', { className: 'vs-header' });
    const title = createElement('div', { className: 'vs-title' });
    title.appendChild(createElement('span', { className: 'vs-logo' }, '🎯'));
    title.appendChild(createElement('span', {}, 'Visual Summarizer'));

    const closeBtn = createElement('button', { className: 'vs-close-btn', type: 'button' }, '×');
    closeBtn.addEventListener('click', closePanel);

    header.appendChild(title);
    header.appendChild(closeBtn);

    // Tabs
    const tabs = createElement('div', { className: 'vs-tabs' });
    const takeawaysTab = createElement('button', {
      className: 'vs-tab active',
      type: 'button',
      dataset: { mode: 'takeaways' }
    }, '📝 Takeaways');
    const visualTab = createElement('button', {
      className: 'vs-tab',
      type: 'button',
      dataset: { mode: 'visual' }
    }, '🗺️ Visual');

    [takeawaysTab, visualTab].forEach(tab => {
      tab.addEventListener('click', () => switchTab(tab));
    });

    tabs.appendChild(takeawaysTab);
    tabs.appendChild(visualTab);

    // Content
    const content = createElement('div', { className: 'vs-content', id: 'vs-content' });
    const welcome = createElement('div', { className: 'vs-welcome' });
    welcome.appendChild(createElement('div', { className: 'vs-welcome-icon' }, '✨'));
    welcome.appendChild(createElement('h3', {}, 'Ready to Summarize'));
    welcome.appendChild(createElement('p', {}, 'Click the button below to generate a summary.'));

    const generateBtn = createElement('button', { className: 'vs-generate-btn', type: 'button' }, 'Generate Summary');
    generateBtn.addEventListener('click', generateSummary);
    welcome.appendChild(generateBtn);
    content.appendChild(welcome);

    // Footer
    const footer = createElement('div', { className: 'vs-footer' });
    const regenerateBtn = createElement('button', {
      className: 'vs-regenerate-btn',
      type: 'button',
      id: 'vs-regenerate'
    }, '🔄 Regenerate');
    regenerateBtn.style.display = 'none';
    regenerateBtn.addEventListener('click', generateSummary);

    const saveBtn = createElement('button', {
      className: 'vs-save-btn',
      type: 'button',
      id: 'vs-save'
    }, '💾 Save');
    saveBtn.style.display = 'none';
    saveBtn.addEventListener('click', saveSummary);

    footer.appendChild(regenerateBtn);
    footer.appendChild(saveBtn);

    // Assemble panel
    panel.appendChild(header);
    panel.appendChild(tabs);
    panel.appendChild(content);
    panel.appendChild(footer);

    document.body.appendChild(panel);
    document.body.style.marginRight = '450px';

    // Load saved mode
    chrome.runtime.sendMessage({ action: 'getSettings' }, (response) => {
      if (chrome.runtime.lastError) return;
      if (response?.defaultMode && ['takeaways', 'visual'].includes(response.defaultMode)) {
        currentMode = response.defaultMode;
        updateTabsUI();
      }
    });
  }

  function switchTab(tab) {
    if (isLoading) return;
    const mode = tab.dataset.mode;
    if (!['takeaways', 'visual'].includes(mode)) return;

    currentMode = mode;
    updateTabsUI();

    const content = document.getElementById('vs-content');
    if (content && !content.querySelector('.vs-welcome')) {
      generateSummary();
    }
  }

  function updateTabsUI() {
    if (!panel) return;
    panel.querySelectorAll('.vs-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.mode === currentMode);
    });
  }

  function closePanel() {
    if (panel) {
      panel.classList.remove('vs-visible');
      document.body.style.marginRight = '0';
    }
  }

  function extractPageText() {
    const hostname = window.location.hostname;
    let text = '';

    // Site-specific extraction
    if (hostname.includes('twitter.com') || hostname.includes('x.com')) {
      const selectors = ['[data-testid="tweetText"]', 'article [lang]'];
      for (const selector of selectors) {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
          text = Array.from(elements)
            .map(t => t.textContent || '')
            .filter(t => t.length > 10)
            .join('\n\n');
          break;
        }
      }
      if (text.length < CONFIG.MIN_TEXT_LENGTH) {
        const articles = document.querySelectorAll('article');
        text = Array.from(articles).map(a => a.textContent || '').join('\n\n');
      }
    } else {
      const selectors = ['article', '[role="article"]', '.post-content', 'main', '.content'];
      for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element && (element.textContent?.length || 0) > 200) {
          text = element.textContent || '';
          break;
        }
      }

      if (!text || text.length < 200) {
        const clone = document.body.cloneNode(true);
        clone.querySelectorAll('script, style, nav, footer, header, aside').forEach(el => el.remove());
        text = clone.textContent || '';
      }
    }

    // Sanitize and limit
    text = text.replace(/\s+/g, ' ').trim();
    return text.length > CONFIG.MAX_TEXT_LENGTH
      ? text.substring(0, CONFIG.MAX_TEXT_LENGTH)
      : text;
  }

  async function generateSummary() {
    if (isLoading) return;
    isLoading = true;

    const content = document.getElementById('vs-content');
    if (!content) return;

    // Show loading
    content.innerHTML = '';
    const loading = createElement('div', { className: 'vs-loading' });
    loading.appendChild(createElement('div', { className: 'vs-spinner' }));
    loading.appendChild(createElement('p', {}, 'Analyzing...'));
    content.appendChild(loading);

    try {
      const settings = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ action: 'getSettings' }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error('Extension error'));
            return;
          }
          resolve(response);
        });
      });

      if (!settings?.apiKey === true) {
        throw new Error('API key not configured');
      }

      const text = extractPageText();
      if (text.length < CONFIG.MIN_TEXT_LENGTH) {
        throw new Error('Not enough content to summarize');
      }

      const response = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          action: 'callClaudeAPI',
          text: text,
          mode: currentMode
        }, (res) => {
          if (chrome.runtime.lastError) {
            reject(new Error('API request failed'));
            return;
          }
          if (!res) {
            reject(new Error('No response'));
            return;
          }
          if (res.success) {
            resolve(res.data);
          } else {
            reject(new Error(res.error || 'API error'));
          }
        });
      });

      renderResult(response);

      const regenerateBtn = document.getElementById('vs-regenerate');
      const saveBtn = document.getElementById('vs-save');
      if (regenerateBtn) regenerateBtn.style.display = 'block';
      if (saveBtn) saveBtn.style.display = 'block';

    } catch (error) {
      showError(error.message);
    } finally {
      isLoading = false;
    }
  }

  function renderResult(text) {
    if (currentMode === 'takeaways') {
      renderTakeaways(text);
    } else {
      renderVisual(text);
    }
  }

  function renderTakeaways(text) {
    const content = document.getElementById('vs-content');
    if (!content || typeof text !== 'string') return;

    content.innerHTML = '';
    const container = createElement('div', { className: 'vs-takeaways' });

    const sections = text.split(/## /);
    sections.forEach(section => {
      if (!section.trim()) return;

      const lines = section.split('\n');
      const title = (lines[0] || '').trim().toUpperCase();
      const body = lines.slice(1).join('\n').trim();

      const sectionEl = createElement('div', { className: 'vs-section' });

      if (title.includes('SUMMARY')) {
        sectionEl.appendChild(createElement('h2', {}, 'Summary'));
        sectionEl.appendChild(createElement('p', {}, body));
      } else if (title.includes('KEY POINTS') || title.includes('POINTS')) {
        sectionEl.appendChild(createElement('h2', {}, 'Key Points'));
        const ul = createElement('ul', { className: 'vs-keypoints' });
        body.split('\n')
          .filter(line => line.trim().startsWith('-'))
          .forEach(line => {
            const pointText = line.replace(/^-\s*/, '').trim();
            const li = createElement('li');
            li.appendChild(createElement('span', { className: 'vs-point-text' }, pointText));

            const btnsDiv = createElement('div', { className: 'vs-point-btns' });

            const saveBtn = createElement('button', {
              className: 'vs-save-point-btn',
              type: 'button',
              title: 'Save point'
            }, '☆');
            saveBtn.addEventListener('click', () => savePoint(pointText, saveBtn));

            // Check if already saved
            chrome.storage.local.get(['savedPoints'], (result) => {
              const saved = result.savedPoints || [];
              if (saved.some(p => p.text === pointText)) {
                saveBtn.textContent = '★';
                saveBtn.classList.add('saved');
              }
            });

            btnsDiv.appendChild(saveBtn);

            const expandBtn = createElement('button', {
              className: 'vs-expand-btn',
              type: 'button',
              title: 'More details'
            }, '→');
            expandBtn.addEventListener('click', () => expandPoint(pointText, li));
            btnsDiv.appendChild(expandBtn);

            li.appendChild(btnsDiv);

            ul.appendChild(li);
          });
        sectionEl.appendChild(ul);
      } else if (title.includes('STATS') || title.includes('DATA')) {
        sectionEl.className = 'vs-section vs-stats';
        sectionEl.appendChild(createElement('h2', {}, 'Stats & Data'));
        const ul = createElement('ul');
        const items = body.split('\n').filter(line => line.trim().startsWith('-'));
        if (items.length === 0) {
          ul.appendChild(createElement('li', {}, 'No specific data mentioned'));
        } else {
          items.forEach(line => {
            ul.appendChild(createElement('li', {}, line.replace(/^-\s*/, '').trim()));
          });
        }
        sectionEl.appendChild(ul);
      } else {
        return;
      }

      container.appendChild(sectionEl);
    });

    // Add images section
    const images = extractPageImages();
    if (images.length > 0) {
      const imagesSection = createElement('div', { className: 'vs-section vs-images' });
      imagesSection.appendChild(createElement('h2', {}, `Images (${images.length})`));
      const grid = createElement('div', { className: 'vs-images-grid' });
      images.forEach(src => {
        const img = createElement('img', { src, className: 'vs-thumb', loading: 'lazy' });
        img.addEventListener('click', () => window.open(src, '_blank'));
        grid.appendChild(img);
      });
      imagesSection.appendChild(grid);
      container.appendChild(imagesSection);
    }

    content.appendChild(container);
  }

  // Extract images from page
  function extractPageImages() {
    const images = [];
    const seen = new Set();

    document.querySelectorAll('article img, main img, .post-content img, .content img, [role="article"] img').forEach(img => {
      const src = img.src || img.dataset.src;
      if (src && !seen.has(src) && !src.includes('avatar') && !src.includes('icon') && img.width > 100) {
        seen.add(src);
        images.push(src);
      }
    });

    return images.slice(0, 10); // Max 10 images
  }

  // Save a key point
  async function savePoint(pointText, btnElement) {
    try {
      const { savedPoints } = await chrome.storage.local.get(['savedPoints']);
      const points = savedPoints || [];

      // Check if already saved
      const exists = points.some(p => p.text === pointText);
      if (exists) {
        // Remove if already saved
        const updated = points.filter(p => p.text !== pointText);
        await chrome.storage.local.set({ savedPoints: updated });
        btnElement.textContent = '☆';
        btnElement.classList.remove('saved');
      } else {
        // Add new point
        points.unshift({
          text: pointText,
          url: window.location.href,
          title: document.title,
          timestamp: new Date().toISOString()
        });
        // Keep max 50 points
        while (points.length > 50) points.pop();
        await chrome.storage.local.set({ savedPoints: points });
        btnElement.textContent = '★';
        btnElement.classList.add('saved');
      }
    } catch (e) {}
  }

  // Expand a key point with more details
  async function expandPoint(pointText, liElement) {
    const existingDetail = liElement.querySelector('.vs-point-detail');
    if (existingDetail) {
      existingDetail.remove();
      return;
    }

    const detailDiv = createElement('div', { className: 'vs-point-detail vs-loading-inline' });
    detailDiv.appendChild(createElement('span', {}, 'Loading...'));
    liElement.appendChild(detailDiv);

    try {
      const response = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          action: 'expandPoint',
          point: pointText
        }, (res) => {
          if (chrome.runtime.lastError || !res) {
            reject(new Error('Request failed'));
            return;
          }
          if (res.success) {
            resolve(res.data);
          } else {
            reject(new Error(res.error || 'Error'));
          }
        });
      });

      detailDiv.className = 'vs-point-detail';
      detailDiv.innerHTML = '';
      detailDiv.appendChild(createElement('p', {}, response));
    } catch (error) {
      detailDiv.className = 'vs-point-detail vs-error-inline';
      detailDiv.innerHTML = '';
      detailDiv.appendChild(createElement('span', {}, 'Could not load details'));
    }
  }

  function renderVisual(text) {
    const content = document.getElementById('vs-content');
    if (!content || typeof text !== 'string') return;

    content.innerHTML = '';
    const container = createElement('div', { className: 'vs-visual' });

    // Extract blocks
    const structureBlocks = text.match(/```structure([\s\S]*?)```/g) || [];
    const mindmapBlocks = text.match(/```mindmap([\s\S]*?)```/g) || [];

    // Render mindmap as visual CSS tree
    mindmapBlocks.forEach(block => {
      const code = block.replace(/```mindmap\n?/, '').replace(/```$/, '').trim();
      const section = createElement('div', { className: 'vs-diagram' });
      section.appendChild(createElement('h3', {}, '🧠 Mind Map'));

      const mindmapContainer = createElement('div', { className: 'vs-mindmap' });
      const tree = parseMindmapToTree(code);
      renderMindmapTree(tree, mindmapContainer);
      section.appendChild(mindmapContainer);
      container.appendChild(section);
    });

    // Render structure blocks
    structureBlocks.forEach(block => {
      const code = block.replace(/```structure\n?/, '').replace(/```$/, '').trim();
      const section = createElement('div', { className: 'vs-structure' });
      section.appendChild(createElement('h3', {}, '📋 Structure'));
      const pre = createElement('pre', { className: 'vs-tree' });
      pre.textContent = code;
      section.appendChild(pre);
      container.appendChild(section);
    });

    // Fallback if no blocks found
    if (mindmapBlocks.length === 0 && structureBlocks.length === 0) {
      const section = createElement('div', { className: 'vs-structure' });
      section.appendChild(createElement('h3', {}, '📋 Response'));
      const pre = createElement('pre', { className: 'vs-tree' });
      pre.textContent = text;
      section.appendChild(pre);
      container.appendChild(section);
    }

    // Add images section
    const images = extractPageImages();
    if (images.length > 0) {
      const imagesSection = createElement('div', { className: 'vs-section vs-images' });
      imagesSection.appendChild(createElement('h2', {}, `Images (${images.length})`));
      const grid = createElement('div', { className: 'vs-images-grid' });
      images.forEach(src => {
        const img = createElement('img', { src, className: 'vs-thumb', loading: 'lazy' });
        img.addEventListener('click', () => window.open(src, '_blank'));
        grid.appendChild(img);
      });
      imagesSection.appendChild(grid);
      container.appendChild(imagesSection);
    }

    content.appendChild(container);
  }

  // Parse mindmap text to tree structure
  function parseMindmapToTree(text) {
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length === 0) return null;

    const root = { text: lines[0].trim(), children: [] };
    let currentCategory = null;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (line.startsWith('  ') && !line.startsWith('    ')) {
        // Category level (2 spaces)
        currentCategory = { text: trimmed, children: [] };
        root.children.push(currentCategory);
      } else if (line.startsWith('    ') || trimmed.startsWith('-')) {
        // Point level (4 spaces or starts with -)
        const pointText = trimmed.replace(/^-\s*/, '');
        if (currentCategory) {
          currentCategory.children.push({ text: pointText, children: [] });
        }
      }
    }

    return root;
  }

  // Render mindmap tree as visual HTML
  function renderMindmapTree(tree, container) {
    if (!tree) return;

    // Root node
    const rootNode = createElement('div', { className: 'vs-mm-root' });
    rootNode.appendChild(createElement('span', { className: 'vs-mm-root-text' }, tree.text));
    container.appendChild(rootNode);

    // Branches container
    const branchesContainer = createElement('div', { className: 'vs-mm-branches' });

    tree.children.forEach(category => {
      const branch = createElement('div', { className: 'vs-mm-branch' });

      // Category node
      const catNode = createElement('div', { className: 'vs-mm-category' });
      catNode.appendChild(createElement('span', {}, category.text));
      branch.appendChild(catNode);

      // Points
      if (category.children.length > 0) {
        const points = createElement('div', { className: 'vs-mm-points' });
        category.children.forEach(point => {
          const pointNode = createElement('div', { className: 'vs-mm-point' });
          pointNode.appendChild(createElement('span', {}, point.text));
          points.appendChild(pointNode);
        });
        branch.appendChild(points);
      }

      branchesContainer.appendChild(branch);
    });

    container.appendChild(branchesContainer);
  }


  function showError(message) {
    const content = document.getElementById('vs-content');
    if (!content) return;

    content.innerHTML = '';
    const error = createElement('div', { className: 'vs-error' });
    error.appendChild(createElement('div', { className: 'vs-error-icon' }, '⚠️'));
    error.appendChild(createElement('h3', {}, 'Error'));
    error.appendChild(createElement('p', {}, sanitize(message)));

    const retryBtn = createElement('button', { className: 'vs-generate-btn', type: 'button' }, 'Try Again');
    retryBtn.addEventListener('click', generateSummary);
    error.appendChild(retryBtn);

    content.appendChild(error);
  }

  function saveSummary() {
    const content = document.getElementById('vs-content');
    if (!content) return;

    try {
      const saved = JSON.parse(localStorage.getItem('vs-summaries') || '[]');
      if (!Array.isArray(saved)) return;

      saved.unshift({
        url: window.location.href,
        title: document.title,
        mode: currentMode,
        timestamp: new Date().toISOString()
      });

      // Keep only last 20
      while (saved.length > 20) saved.pop();
      localStorage.setItem('vs-summaries', JSON.stringify(saved));

      const saveBtn = document.getElementById('vs-save');
      if (saveBtn) {
        saveBtn.textContent = '✓ Saved';
        setTimeout(() => { saveBtn.textContent = '💾 Save'; }, 2000);
      }
    } catch (e) {}
  }

})();
