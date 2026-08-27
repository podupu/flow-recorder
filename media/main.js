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

  function showStatus(text) {
    let status = document.getElementById('status');
    if (!status) {
      status = document.createElement('div');
      status.id = 'status';
      document.body.insertBefore(status, blocksEl);
    }
    status.textContent = text;
    status.style.display = 'block';
    setTimeout(() => { status.style.display = 'none'; }, 2000);
  }

  // path -> webview URI, supplied by the extension (webviews cannot load file:// directly).
  let assets = {};

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
        // Legacy block from the old scaffold - not a real Maestro command.
        card.classList.add('block-api', 'block-invalid');
        const req = step.apiRequest;
        body.innerHTML = `
          <div class="block-title">apiRequest &middot; ${escapeHtml(req.method || '')} ${escapeHtml(req.url || '')}</div>
          <div class="block-invalid-note">Not a Maestro command - reopen this flow to convert it to evalScript + assertTrue.</div>
        `;
      } else if (step.evalScript) {
        card.classList.add('block-script');
        body.innerHTML = `
          <div class="block-title">evalScript</div>
          <pre class="block-body">${escapeHtml(step.evalScript)}</pre>
        `;
      } else if (step.runScript) {
        card.classList.add('block-script');
        body.innerHTML = `
          <div class="block-title">runScript</div>
          <div class="block-meta">${escapeHtml(step.runScript)}</div>
        `;
      } else if (step.assertTrue) {
        card.classList.add('block-assert');
        body.innerHTML = `
          <div class="block-title">assertTrue</div>
          <pre class="block-body">${escapeHtml(step.assertTrue)}</pre>
        `;
      } else if (step.takeScreenshot) {
        card.classList.add('block-screenshot');
        const shotPath = step.takeScreenshot;
        const shotSrc = assets[shotPath];
        body.innerHTML = `
          <div class="block-title">Screenshot</div>
          ${shotSrc
            ? `<img class="screenshot-thumb" src="${escapeHtml(shotSrc)}" alt="${escapeHtml(shotPath)}" />`
            : ''}
          <div class="block-meta">${escapeHtml(shotPath)}</div>
        `;
        // The file may have been moved or deleted since it was recorded.
        const img = body.querySelector('.screenshot-thumb');
        if (img) {
          img.addEventListener('error', () => {
            img.remove();
            const missing = document.createElement('div');
            missing.className = 'screenshot-missing';
            missing.textContent = 'Image not found: ' + shotPath;
            body.appendChild(missing);
          });
        }
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
      assets = message.assets || {};
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
    const name = prompt('Screenshot name (saved to assets/ beside this flow):', 'screenshot');
    if (name === null) return;
    vscode.postMessage({ type: 'addScreenshotBlock', name });
  });

  const commandForm = document.getElementById('commandForm');
  const commandType = document.getElementById('commandType');
  const commandFields = document.getElementById('commandFields');
  const commandSubmit = document.getElementById('commandSubmit');

  const FIELD_SPECS = {
    assertVisible: [{ id: 'selector', label: 'Text or selector', type: 'text', required: true }],
    assertNotVisible: [{ id: 'selector', label: 'Text or selector', type: 'text', required: true }],
    waitForAnimationToEnd: [{ id: 'timeout', label: 'Timeout (ms)', type: 'number', value: 5000 }],
    extendedWaitUntil: [
      { id: 'selector', label: 'Visible text', type: 'text', required: true },
      { id: 'timeout', label: 'Timeout (ms)', type: 'number', value: 120000 }
    ],
    openLink: [{ id: 'uri', label: 'Link / URI', type: 'text', required: true }],
    runFlow: [{ id: 'path', label: 'Flow file path', type: 'text', required: true }],
    copyTextFrom: [
      { id: 'selector', label: 'Element text', type: 'text', required: true },
      { id: 'toVar', label: 'Variable name', type: 'text', required: true }
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
    let missing = false;
    specs.forEach((spec) => {
      const value = document.getElementById('cmd-' + spec.id).value;
      if (spec.required && !value.trim()) missing = true;
      args[spec.id] = value;
    });
    if (missing) {
      showStatus('All fields are required');
      return;
    }
    vscode.postMessage({
      type: 'addCommand',
      command: { type: commandType.value, args }
    });
    commandForm.classList.add('hidden');
  });

  vscode.postMessage({ type: 'ready' });
})();
