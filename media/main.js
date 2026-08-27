(function () {
  const vscode = acquireVsCodeApi();
  const blocksEl = document.getElementById('blocks');
  const apiForm = document.getElementById('apiForm');
  const apiMethod = document.getElementById('apiMethod');
  const apiUrl = document.getElementById('apiUrl');
  const apiBody = document.getElementById('apiBody');

  function escapeHtml(str) {
    return String(str).replace(/[&<>"]/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
    ));
  }

  function render(doc) {
    blocksEl.innerHTML = '';
    const steps = doc.steps || [];

    if (steps.length === 0) {
      blocksEl.innerHTML = '<div class="empty">No steps yet. Use the buttons above to add one.</div>';
      return;
    }

    steps.forEach((step, index) => {
      const card = document.createElement('div');
      card.className = 'block-card';

      const del = document.createElement('button');
      del.className = 'delete-btn';
      del.textContent = '\u00d7';
      del.title = 'Delete step';
      del.onclick = () => vscode.postMessage({ type: 'deleteStep', index });
      card.appendChild(del);

      const body = document.createElement('div');

      if (step.apiRequest) {
        card.classList.add('block-api');
        const req = step.apiRequest;
        const res = step.response || {};
        body.innerHTML = `
          <div class="block-title">API &middot; ${escapeHtml(req.method)} ${escapeHtml(req.url)}</div>
          <div class="block-meta">status ${res.status ?? '-'} &middot; ${res.durationMs ?? '-'}ms</div>
          ${res.body ? `<pre class="block-body">${escapeHtml(res.body)}</pre>` : ''}
        `;
      } else if (step.takeScreenshot) {
        card.classList.add('block-screenshot');
        body.innerHTML = `
          <div class="block-title">Screenshot</div>
          <div class="screenshot-placeholder">${escapeHtml(step.takeScreenshot)}</div>
          ${step.note ? `<div class="block-meta">${escapeHtml(step.note)}</div>` : ''}
        `;
      } else if (step.tapOn) {
        card.classList.add('block-tap');
        const target = typeof step.tapOn === 'string'
          ? step.tapOn
          : step.tapOn.text || step.tapOn.id || step.tapOn.point || JSON.stringify(step.tapOn);
        body.innerHTML = `<div class="block-title">Tap &middot; ${escapeHtml(target)}</div>`;
      } else {
        card.classList.add('block-generic');
        body.innerHTML = `<div class="block-title">${escapeHtml(JSON.stringify(step))}</div>`;
      }

      card.appendChild(body);
      blocksEl.appendChild(card);
    });
  }

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (message.type === 'update') {
      render(message.doc);
    }
  });

  function showApiForm() {
    apiForm.classList.remove('hidden');
    apiUrl.focus();
  }

  function hideApiForm() {
    apiForm.classList.add('hidden');
    apiUrl.value = '';
    apiBody.value = '';
    apiMethod.value = 'GET';
    toggleBodyVisibility();
  }

  function toggleBodyVisibility() {
    apiBody.style.display = apiMethod.value === 'GET' ? 'none' : 'block';
  }

  apiMethod.addEventListener('change', toggleBodyVisibility);
  toggleBodyVisibility();

  document.getElementById('addApi').addEventListener('click', showApiForm);
  document.getElementById('apiCancel').addEventListener('click', hideApiForm);

  document.getElementById('apiSubmit').addEventListener('click', () => {
    const url = apiUrl.value.trim();
    if (!url) {
      apiUrl.focus();
      return;
    }
    vscode.postMessage({
      type: 'addApiBlock',
      payload: {
        method: apiMethod.value,
        url,
        body: apiMethod.value === 'GET' ? '' : apiBody.value
      }
    });
    hideApiForm();
  });

  document.getElementById('addScreenshot').addEventListener('click', () => {
    vscode.postMessage({ type: 'addScreenshotBlock' });
  });

  vscode.postMessage({ type: 'ready' });
})();
