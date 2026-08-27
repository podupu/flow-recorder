(function () {
  const vscode = acquireVsCodeApi();
  const canvas = document.getElementById('screen');
  const ctx = canvas.getContext('2d');
  const status = document.getElementById('status');
  const overlay = document.getElementById('overlay');
  const tooltip = document.getElementById('tooltip');
  const img = new Image();
  let frameLoaded = false;
  let elements = [];
  let hoveredElement = null;
  let lastTapTime = 0;

  img.onload = () => {
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    ctx.drawImage(img, 0, 0);
    status.style.display = 'none';
    frameLoaded = true;
  };

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type === 'frame') {
      img.src = 'data:image/png;base64,' + msg.data;
    } else if (msg.type === 'elements') {
      elements = msg.nodes || [];
      renderOverlay();
      renderElementList();
    } else if (msg.type === 'status') {
      showStatus(msg.text);
    }
  });

  function rect() {
    return canvas.getBoundingClientRect();
  }

  function toPct(clientX, clientY) {
    const r = rect();
    return { xPct: (clientX - r.left) / r.width, yPct: (clientY - r.top) / r.height };
  }

  function elementAt(xPct, yPct) {
    let best = null;
    for (const e of elements) {
      if (xPct >= e.left && xPct <= e.left + e.width && yPct >= e.top && yPct <= e.top + e.height) {
        if (!best || e.width * e.height < best.width * best.height) {
          best = e;
        }
      }
    }
    return best;
  }

  function elementsAt(xPct, yPct) {
    const hits = [];
    for (const e of elements) {
      if (xPct >= e.left && xPct <= e.left + e.width && yPct >= e.top && yPct <= e.top + e.height) {
        hits.push(e);
      }
    }
    hits.sort((a, b) => (a.width * a.height) - (b.width * b.height));
    return hits;
  }

  function renderOverlay() {
    overlay.innerHTML = '';
    for (const e of elements) {
      const box = document.createElement('div');
      box.className = 'element-box';
      box.dataset.id = e.elementId;
      box.style.left = e.left * 100 + '%';
      box.style.top = e.top * 100 + '%';
      box.style.width = e.width * 100 + '%';
      box.style.height = e.height * 100 + '%';
      overlay.appendChild(box);
    }
    if (hoveredElement) updateHover(hoveredElement);
  }

  function showStatus(text) {
    status.textContent = text;
    status.style.display = 'block';
    setTimeout(() => { status.style.display = 'none'; }, 2000);
  }

  function elementLabel(e) {
    return e.text || e.resourceId || e.contentDesc || '(unnamed)';
  }

  function elementIdSuffix(e) {
    if (e.text && e.resourceId) return e.resourceId;
    return '';
  }

  function renderElementList() {
    const list = document.getElementById('elements-list');
    list.innerHTML = '';
    for (const e of elements) {
      const row = document.createElement('div');
      row.className = 'element-row';
      row.dataset.id = e.elementId;
      const label = document.createElement('span');
      label.className = 'element-label';
      label.textContent = elementLabel(e);
      row.appendChild(label);
      const suffix = elementIdSuffix(e);
      if (suffix) {
        const idSpan = document.createElement('span');
        idSpan.className = 'element-id';
        idSpan.textContent = suffix;
        row.appendChild(idSpan);
      }
      row.addEventListener('mouseenter', () => updateHover(e));
      row.addEventListener('click', () => vscode.postMessage({ type: 'elementTap', elementId: e.elementId }));
      list.appendChild(row);
    }
    if (hoveredElement) updateHover(hoveredElement);
  }

  function updateHover(e) {
    hoveredElement = e;
    for (const el of overlay.children) {
      const on = el.dataset.id === String(e && e.elementId);
      el.classList.toggle('hover', on);
      const badge = el.querySelector('.element-badge');
      if (on && e) {
        if (!badge) {
          const b = document.createElement('span');
          b.className = 'element-badge';
          b.textContent = elementLabel(e);
          el.appendChild(b);
        } else {
          badge.textContent = elementLabel(e);
        }
      } else if (badge) {
        badge.remove();
      }
    }
    for (const row of document.querySelectorAll('.element-row')) {
      row.classList.toggle('active', row.dataset.id === String(e && e.elementId));
    }
    if (e) {
      renderTooltip(e);
      tooltip.classList.add('show');
    } else {
      tooltip.classList.remove('show');
    }
  }

  function tooltipRow(label, value) {
    const row = document.createElement('div');
    row.className = 'tooltip-row';
    const lbl = document.createElement('span');
    lbl.className = 'tooltip-label';
    lbl.textContent = label + ':';
    row.appendChild(lbl);
    const val = document.createElement('span');
    val.className = 'tooltip-value';
    val.textContent = value;
    row.appendChild(val);
    return row;
  }

  function renderTooltip(e) {
    const stack = document.getElementById('overlap-stack');
    tooltip.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'tooltip-title';
    title.textContent = elementLabel(e);
    tooltip.appendChild(title);
    if (e.text) tooltip.appendChild(tooltipRow('text', e.text));
    if (e.resourceId) tooltip.appendChild(tooltipRow('id', e.resourceId));
    if (e.contentDesc) tooltip.appendChild(tooltipRow('content-desc', e.contentDesc));
    if (e.className) tooltip.appendChild(tooltipRow('class', e.className));
    const pctW = Math.round(e.width * 100);
    const pctH = Math.round(e.height * 100);
    tooltip.appendChild(tooltipRow('bounds', e.left * 100 + '%,' + e.top * 100 + '% ' + pctW + 'x' + pctH));
    if (stack) tooltip.appendChild(stack);
  }

  function renderOverlapStack(hits) {
    const stack = document.getElementById('overlap-stack');
    stack.innerHTML = '';
    if (!hits || hits.length < 2) {
      stack.classList.remove('show');
      return;
    }
    for (const e of hits) {
      const chip = document.createElement('span');
      chip.className = 'overlap-chip' + (hoveredElement && hoveredElement.elementId === e.elementId ? ' active' : '');
      chip.textContent = elementLabel(e);
      chip.addEventListener('mouseenter', () => updateHover(e));
      chip.addEventListener('click', () => vscode.postMessage({ type: 'elementTap', elementId: e.elementId }));
      stack.appendChild(chip);
    }
    stack.classList.add('show');
  }

  let gesture = null;

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (!frameLoaded) return;
    const p = toPct(e.clientX, e.clientY);
    gesture = { start: p, last: p, held: false, moved: false, startTime: Date.now() };
    gesture.holdTimer = setTimeout(() => { gesture.held = true; }, 500);
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = toPct(e.clientX, e.clientY);
    if (gesture) {
      const dx = Math.abs(p.xPct - gesture.start.xPct) * rect().width;
      const dy = Math.abs(p.yPct - gesture.start.yPct) * rect().height;
      if (Math.hypot(dx, dy) > 40) {
        gesture.moved = true;
        clearTimeout(gesture.holdTimer);
      }
      gesture.last = p;
    }
    const hits = elementsAt(p.xPct, p.yPct);
    updateHover(hits[0] || null);
    renderOverlapStack(hits);
  });

  canvas.addEventListener('pointercancel', () => {
    if (gesture) {
      clearTimeout(gesture.holdTimer);
      gesture = null;
    }
  });

  canvas.addEventListener('lostpointercapture', () => {
    if (gesture) {
      clearTimeout(gesture.holdTimer);
      gesture = null;
    }
  });

  canvas.addEventListener('pointerup', (e) => {
    if (!gesture) return;
    clearTimeout(gesture.holdTimer);
    const now = Date.now();
    const duration = now - gesture.startTime;
    const p = gesture.last;
    const el = elementAt(p.xPct, p.yPct);
    if (gesture.moved) {
      vscode.postMessage({
        type: 'swipe',
        startXpct: gesture.start.xPct,
        startYpct: gesture.start.yPct,
        endXpct: p.xPct,
        endYpct: p.yPct
      });
    } else if (gesture.held) {
      vscode.postMessage({
        type: 'longPress',
        elementId: el ? el.elementId : undefined,
        xPct: p.xPct,
        yPct: p.yPct
      });
    } else if (now - lastTapTime < 250) {
      vscode.postMessage({
        type: 'doubleTap',
        elementId: el ? el.elementId : undefined,
        xPct: p.xPct,
        yPct: p.yPct
      });
      lastTapTime = 0;
    } else if (el) {
      vscode.postMessage({ type: 'elementTap', elementId: el.elementId });
      lastTapTime = now;
    } else {
      vscode.postMessage({ type: 'tap', xPct: p.xPct, yPct: p.yPct });
      lastTapTime = now;
    }
    gesture = null;
    showTapDot(p);
  });

  function showTapDot(p) {
    const r = rect();
    const dot = document.createElement('div');
    dot.className = 'tap-dot';
    dot.style.left = r.left + p.xPct * r.width + 'px';
    dot.style.top = r.top + p.yPct * r.height + 'px';
    document.body.appendChild(dot);
    setTimeout(() => dot.remove(), 300);
  }

  const toggleElements = document.getElementById('toggle-elements');
  const elementsPanel = document.getElementById('elements-panel');
  toggleElements.addEventListener('click', () => {
    const collapsed = elementsPanel.classList.toggle('collapsed');
    toggleElements.textContent = collapsed ? '+' : '-';
  });

  // --- Right-click context menu ---
  const contextMenu = document.getElementById('context-menu');
  let menuTarget = null;

  function menuItem(label, onClick) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'menu-item';
    item.textContent = label;
    item.addEventListener('click', () => { hideMenu(); onClick(); });
    return item;
  }

  function menuSeparator(text) {
    const sep = document.createElement('div');
    sep.className = 'menu-separator';
    sep.textContent = text;
    return sep;
  }

  function menuField(id, placeholder, type) {
    const input = document.createElement('input');
    input.type = type || 'text';
    input.id = id;
    input.placeholder = placeholder || '';
    return input;
  }

  function post(msg) {
    vscode.postMessage(msg);
  }

  function targetElement() {
    return menuTarget;
  }

  function elementAction(action) {
    const el = targetElement();
    if (!el) {
      showStatus('Right-click an element to use this action');
      return;
    }
    post({ type: action, elementId: el.elementId });
  }

  function buildMenu() {
    contextMenu.innerHTML = '';
    const target = targetElement();
    const targetRow = document.createElement('div');
    targetRow.className = 'menu-target';
    targetRow.textContent = target ? elementLabel(target) + (target.resourceId ? '  [' + target.resourceId + ']' : '') : 'Empty area — gestures only';
    contextMenu.appendChild(targetRow);

    contextMenu.appendChild(menuSeparator('Gestures'));
    contextMenu.appendChild(menuItem('Tap', () => elementAction('elementTap')));
    contextMenu.appendChild(menuItem('Long press', () => elementAction('longPress')));
    contextMenu.appendChild(menuItem('Double tap', () => elementAction('doubleTap')));
    contextMenu.appendChild(menuItem('Assert visible', () => elementAction('assertVisible')));
    contextMenu.appendChild(menuItem('Assert not visible', () => elementAction('assertNotVisible')));

    contextMenu.appendChild(menuSeparator('Text & keyboard'));
    const inputTextField = menuField('menu-input', 'Text to type...');
    contextMenu.appendChild(inputTextField);
    contextMenu.appendChild(menuItem('Input text', () => {
      const el = targetElement();
      post({ type: 'inputText', text: inputTextField.value, elementId: el ? el.elementId : undefined });
      inputTextField.value = '';
    }));
    const eraseField = menuField('menu-erase', 'Chars to erase', 'number');
    eraseField.value = '50';
    contextMenu.appendChild(eraseField);
    contextMenu.appendChild(menuItem('Erase', () => {
      post({ type: 'eraseText', count: parseInt(eraseField.value, 10) || 50 });
    }));
    contextMenu.appendChild(menuItem('Back', () => post({ type: 'back' })));
    contextMenu.appendChild(menuItem('Back key', () => post({ type: 'pressKey', key: 'back' })));
    contextMenu.appendChild(menuItem('Home', () => post({ type: 'pressKey', key: 'home' })));
    contextMenu.appendChild(menuItem('Enter', () => post({ type: 'pressKey', key: 'enter' })));
    contextMenu.appendChild(menuItem('Hide keyboard', () => post({ type: 'hideKeyboard' })));
    contextMenu.appendChild(menuItem('Paste', () => post({ type: 'pasteText' })));

    contextMenu.appendChild(menuSeparator('App'));
    const launchClear = menuField('menu-launch-clear', '', 'checkbox');
    const launchWrap = document.createElement('label');
    launchWrap.className = 'menu-item menu-check';
    launchWrap.appendChild(launchClear);
    launchWrap.appendChild(document.createTextNode(' Clear state on launch'));
    contextMenu.appendChild(launchWrap);
    contextMenu.appendChild(menuItem('Launch app', () => post({ type: 'launchApp', clearState: launchClear.checked })));
    contextMenu.appendChild(menuItem('Stop app', () => post({ type: 'stopApp' })));
    contextMenu.appendChild(menuItem('Kill app', () => post({ type: 'killApp', clearState: launchClear.checked })));
    contextMenu.appendChild(menuItem('Clear app state', () => post({ type: 'clearState' })));
    contextMenu.appendChild(menuItem('Toggle dark mode', () => post({ type: 'toggleDarkMode' })));

    contextMenu.appendChild(menuSeparator('Device'));
    contextMenu.appendChild(menuItem('Landscape', () => post({ type: 'setOrientation', orientation: 'LANDSCAPE' })));
    contextMenu.appendChild(menuItem('Portrait', () => post({ type: 'setOrientation', orientation: 'PORTRAIT' })));
    contextMenu.appendChild(menuItem('Scroll', () => post({ type: 'scroll' })));
    contextMenu.appendChild(menuItem('Toggle airplane mode', () => post({ type: 'toggleAirplaneMode' })));
    const clipboardField = menuField('menu-clipboard', 'Clipboard text...');
    contextMenu.appendChild(clipboardField);
    contextMenu.appendChild(menuItem('Set clipboard', () => {
      if (clipboardField.value) {
        post({ type: 'setClipboard', text: clipboardField.value });
        clipboardField.value = '';
      }
    }));

    contextMenu.appendChild(menuSeparator('Capture'));
    const shotField = menuField('menu-shot', 'screenshot-name');
    contextMenu.appendChild(shotField);
    contextMenu.appendChild(menuItem('Take screenshot', () => {
      post({ type: 'takeScreenshot', name: shotField.value });
      shotField.value = '';
    }));
    const optionalBox = menuField('menu-optional', '', 'checkbox');
    const optWrap = document.createElement('label');
    optWrap.className = 'menu-item menu-check';
    optWrap.appendChild(optionalBox);
    optWrap.appendChild(document.createTextNode(' Record steps as optional'));
    contextMenu.appendChild(optWrap);
    optionalBox.addEventListener('change', () => post({ type: 'optional', value: optionalBox.checked }));
  }

  function showMenu(x, y) {
    buildMenu();
    contextMenu.style.left = x + 'px';
    contextMenu.style.top = y + 'px';
    contextMenu.classList.remove('hidden');
    contextMenu.classList.add('show');
  }

  function hideMenu() {
    contextMenu.classList.add('hidden');
    contextMenu.classList.remove('show');
  }

  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const p = toPct(e.clientX, e.clientY);
    const el = elementAt(p.xPct, p.yPct);
    menuTarget = el;
    updateHover(el);
    showMenu(e.clientX, e.clientY);
  });

  document.addEventListener('click', (e) => {
    if (!contextMenu.contains(e.target)) hideMenu();
  });
})();
