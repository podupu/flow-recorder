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
    for (const e of elements) {
      if (xPct >= e.left && xPct <= e.left + e.width && yPct >= e.top && yPct <= e.top + e.height) {
        return e;
      }
    }
    return null;
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
  }

  function showStatus(text) {
    status.textContent = text;
    status.style.display = 'block';
    setTimeout(() => { status.style.display = 'none'; }, 2000);
  }

  function selectorLabel(e) {
    return e.selector ? JSON.stringify(e.selector) : e.text || e.resourceId || e.contentDesc || '';
  }

  function updateHover(e) {
    hoveredElement = e;
    for (const el of overlay.children) {
      el.classList.toggle('hover', el.dataset.id === String(e && e.elementId));
    }
    if (e) {
      tooltip.textContent = selectorLabel(e);
      tooltip.classList.add('show');
    } else {
      tooltip.classList.remove('show');
    }
  }

  let gesture = null;

  canvas.addEventListener('pointerdown', (e) => {
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
    updateHover(elementAt(p.xPct, p.yPct));
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
    } else if (el) {
      vscode.postMessage({ type: 'elementTap', elementId: el.elementId });
    } else {
      vscode.postMessage({ type: 'tap', xPct: p.xPct, yPct: p.yPct });
    }
    lastTapTime = now;
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

  const optionalBox = document.getElementById('optional');
  optionalBox.addEventListener('change', () => {
    vscode.postMessage({ type: 'optional', value: optionalBox.checked });
  });

  const inputField = document.getElementById('inputText');
  function doInput() {
    const text = inputField.value;
    if (!text) return;
    vscode.postMessage({ type: 'inputText', text, elementId: hoveredElement && hoveredElement.elementId });
    inputField.value = '';
  }
  document.getElementById('doInput').addEventListener('click', doInput);
  inputField.addEventListener('keydown', (e) => { if (e.key === 'Enter') doInput(); });

  document.getElementById('doErase').addEventListener('click', () => {
    const count = parseInt(document.getElementById('eraseCount').value, 10) || 50;
    vscode.postMessage({ type: 'eraseText', count });
  });

  document.getElementById('doScreenshot').addEventListener('click', () => {
    const name = document.getElementById('screenshotName').value.trim();
    vscode.postMessage({ type: 'takeScreenshot', name });
    document.getElementById('screenshotName').value = '';
  });

  document.querySelector('[data-action="setClipboard"]').addEventListener('click', () => {
    const input = document.getElementById('clipboardText');
    const text = input.value;
    if (!text) return;
    vscode.postMessage({ type: 'setClipboard', text });
    input.value = '';
  });

  const launchClear = document.getElementById('launchClear');

  const singleActions = {
    tap: () => {
      if (hoveredElement) vscode.postMessage({ type: 'elementTap', elementId: hoveredElement.elementId });
      else showStatus('Hover an element to tap it');
    },
    longPress: () => vscode.postMessage({ type: 'longPress', elementId: hoveredElement && hoveredElement.elementId }),
    doubleTap: () => vscode.postMessage({ type: 'doubleTap', elementId: hoveredElement && hoveredElement.elementId }),
    assertVisible: () => vscode.postMessage({ type: 'assertVisible', elementId: hoveredElement && hoveredElement.elementId }),
    assertNotVisible: () => vscode.postMessage({ type: 'assertNotVisible', elementId: hoveredElement && hoveredElement.elementId }),
    back: () => vscode.postMessage({ type: 'back' }),
    hideKeyboard: () => vscode.postMessage({ type: 'hideKeyboard' }),
    pasteText: () => vscode.postMessage({ type: 'pasteText' }),
    scroll: () => vscode.postMessage({ type: 'scroll' }),
    stopApp: () => vscode.postMessage({ type: 'stopApp' }),
    killApp: () => vscode.postMessage({ type: 'killApp' }),
    clearState: () => vscode.postMessage({ type: 'clearState' }),
    toggleDarkMode: () => vscode.postMessage({ type: 'toggleDarkMode' }),
    toggleAirplaneMode: () => vscode.postMessage({ type: 'toggleAirplaneMode' })
  };

  document.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      if (singleActions[action]) {
        singleActions[action]();
        return;
      }
      if (action === 'pressKey') {
        vscode.postMessage({ type: 'pressKey', key: btn.dataset.key });
      } else if (action === 'setOrientation') {
        vscode.postMessage({ type: 'setOrientation', orientation: btn.dataset.orientation });
      } else if (action === 'launchApp') {
        vscode.postMessage({ type: 'launchApp', clearState: launchClear.checked });
      }
    });
  });
})();
