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

      const optWrap = document.createElement('label');
      optWrap.className = 'opt-toggle';
      const optBox = document.createElement('input');
      optBox.type = 'checkbox';
      optBox.checked = !!step.optional;
      optBox.onchange = () => vscode.postMessage({ type: 'setOptional', index, optional: optBox.checked });
      optWrap.appendChild(optBox);
      optWrap.appendChild(document.createTextNode(' optional'));
      card.appendChild(optWrap);

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

  const commandForm = document.getElementById('commandForm');
  const commandType = document.getElementById('commandType');
  const commandFields = document.getElementById('commandFields');
  const commandSubmit = document.getElementById('commandSubmit');

  const FIELD_SPECS = {
    assertVisible: [{ id: 'selector', label: 'Text or selector', type: 'text' }],
    assertNotVisible: [{ id: 'selector', label: 'Text or selector', type: 'text' }],
    waitForAnimationToEnd: [{ id: 'timeout', label: 'Timeout (ms)', type: 'number', value: 5000 }],
    extendedWaitUntil: [
      { id: 'selector', label: 'Visible text', type: 'text' },
      { id: 'timeout', label: 'Timeout (ms)', type: 'number', value: 120000 }
    ],
    openLink: [{ id: 'uri', label: 'Link / URI', type: 'text' }],
    runFlow: [{ id: 'path', label: 'Flow file path', type: 'text' }],
    copyTextFrom: [
      { id: 'selector', label: 'Element text', type: 'text' },
      { id: 'toVar', label: 'Variable name', type: 'text' }
    ]
  };

  function renderCommandFields() {
    commandFields.innerHTML = '';
    const specs = FIELD_SPECS[commandType.value] || [];
    specs.forEach((spec) => {
      const row = document.createElement('div');
      row.className = 'form-row';
      const label = document.createElement('label');
      label.textContent = spec.label;
      const input = document.createElement('input');
      input.type = spec.type || 'text';
      input.id = 'cmd-' + spec.id;
      input.value = spec.value !== undefined ? spec.value : '';
      row.appendChild(label);
      row.appendChild(input);
      commandFields.appendChild(row);
    });
  }

  document.getElementById('addCommandBtn').addEventListener('click', () => {
    commandForm.classList.remove('hidden');
    renderCommandFields();
    commandType.focus();
  });

  document.getElementById('commandCancel').addEventListener('click', () => {
    commandForm.classList.add('hidden');
  });

  commandType.addEventListener('change', renderCommandFields);

  commandSubmit.addEventListener('click', () => {
    const args = {};
    const specs = FIELD_SPECS[commandType.value] || [];
    specs.forEach((spec) => {
      args[spec.id] = document.getElementById('cmd-' + spec.id).value;
    });
    vscode.postMessage({
      type: 'addCommand',
      command: { type: commandType.value, args }
    });
    commandForm.classList.add('hidden');
  });

  vscode.postMessage({ type: 'ready' });
})();
