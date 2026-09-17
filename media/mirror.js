(function () {
  const vscode = acquireVsCodeApi();
  const canvas = document.getElementById('screen');
  const ctx = canvas.getContext('2d');
  const status = document.getElementById('status');
  const overlay = document.getElementById('overlay');
  const img = new Image();
  let frameLoaded = false;
  let hierarchyReady = false;
  let recording = false;
  const recordingToggle = document.getElementById('recording-toggle');
  recordingToggle.addEventListener('click', () => {
    vscode.postMessage({ type: 'setRecording', value: !recording });
  });
  let elements = [];
  // Soft-keyboard region (0-1 fractions) or null. The IME is a separate window that never
  // appears in the hierarchy dump, so points inside it must not resolve to the app view behind.
  let keyboard = null;
  let hoveredElement = null;
  let lastTapTime = 0;
  // "Show all elements" mode - every selectable element outlined and numbered at once, like
  // Maestro Studio's inspector, rather than only the one under the cursor.
  let showAllElements = false;

  img.onload = () => {
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    ctx.drawImage(img, 0, 0);
    status.style.display = 'none';
    frameLoaded = true;
  };

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type === 'recordingState') {
      recording = msg.recording === true;
      recordingToggle.setAttribute('aria-pressed', String(recording));
      recordingToggle.textContent = recording ? 'Stop recording' : 'Start recording';
      document.getElementById('recording-label').textContent = recording
        ? 'Recording — interactions append steps to the flow below.'
        : 'Control only — interactions do not change your flow.';
    } else if (msg.type === 'frame') {
      img.src = 'data:image/png;base64,' + msg.data;
    } else if (msg.type === 'elements') {
      hierarchyReady = true;
      elements = msg.nodes || [];
      keyboard = msg.keyboard || null;
      renderKeyboardMask();
      renderOverlay();
      showCoverageNote(msg.coverageNote);
      renderElementPicker();
    } else if (msg.type === 'frameError') {
      frameLoaded = false;
      const banner = document.getElementById('frame-banner');
      if (banner.textContent !== msg.text) banner.textContent = msg.text;
      banner.classList.remove('hidden');
    } else if (msg.type === 'frameOk') {
      document.getElementById('frame-banner').classList.add('hidden');
    } else if (msg.type === 'status') {
      showStatus(msg.text);
    } else if (msg.type === 'hierarchyError') {
      showHierarchyProblem(msg.text);
    } else if (msg.type === 'hierarchyOk') {
      clearHierarchyProblem();
    } else if (msg.type === 'target') {
      const el = document.getElementById('record-target-path');
      if (el) el.textContent = msg.path;
    }
  });

  /**
   * Regions the app hides from accessibility. Deliberately separate from the hierarchy banner:
   * that one reports OUR failure to read the tree, this reports a tree that was read fine and
   * genuinely has nothing in part of it. The fix for each lives in a different codebase.
   */
  function showCoverageNote(text) {
    const note = document.getElementById('coverage-note');
    if (!note) return;
    if (!text) {
      note.classList.add('hidden');
      note.textContent = '';
      return;
    }
    note.textContent = text;
    note.classList.remove('hidden');
  }

  // Element detection failing used to look identical to "this screen has no elements".
  // The banner keeps the real reason on screen until the dump succeeds again.
  function showHierarchyProblem(text) {
    const banner = document.getElementById('hierarchy-banner');
    if (!banner) return;
    if (banner.textContent !== text) banner.textContent = text;
    banner.classList.remove('hidden');
    elements = [];
    hierarchyReady = false;
    keyboard = null;
    renderKeyboardMask();
    showCoverageNote('');
    updateHover(null);
    renderOverlay();
    renderElementPicker();
  }

  function clearHierarchyProblem() {
    const banner = document.getElementById('hierarchy-banner');
    if (banner) banner.classList.add('hidden');
  }

  function rect() {
    return canvas.getBoundingClientRect();
  }

  function toPct(clientX, clientY) {
    const r = rect();
    return { xPct: (clientX - r.left) / r.width, yPct: (clientY - r.top) / r.height };
  }

  function isLabeled(e) {
    return !!(e.text || e.resourceId || e.contentDesc);
  }

  function inKeyboard(xPct, yPct) {
    if (!keyboard) return false;
    return (
      xPct >= keyboard.left &&
      xPct <= keyboard.left + keyboard.width &&
      yPct >= keyboard.top &&
      yPct <= keyboard.top + keyboard.height
    );
  }

  function renderKeyboardMask() {
    const mask = document.getElementById('keyboard-mask');
    if (!mask) return;
    if (!keyboard) {
      mask.classList.remove('show');
      return;
    }
    mask.style.left = keyboard.left * 100 + '%';
    mask.style.top = keyboard.top * 100 + '%';
    mask.style.width = keyboard.width * 100 + '%';
    mask.style.height = keyboard.height * 100 + '%';
    mask.classList.add('show');
  }

  function elementAt(xPct, yPct) {
    // Anything under the keyboard belongs to the IME window, not to the app view behind it.
    if (inKeyboard(xPct, yPct)) return null;
    let best = null;
    for (const e of elements) {
      if (xPct >= e.left && xPct <= e.left + e.width && yPct >= e.top && yPct <= e.top + e.height) {
        if (!best || e.width * e.height < best.width * best.height) {
          best = e;
        }
      }
    }
    while (best && !isLabeled(best) && best.parentId >= 0 && elements[best.parentId]) {
      best = elements[best.parentId];
    }
    return best;
  }

  /**
   * Row-by-row, left-to-right ordering for the "show all" badge numbers - matches how a person
   * reads the screen rather than the raw hierarchy order, which can jump around unpredictably.
   * Kept identical to src/readingOrder.ts (unit tested there); this webview sandbox cannot
   * `require` extension-host code, so the same small algorithm is duplicated here - the same
   * pattern already used for hit-testing between mirrorPanel.ts and this file.
   */
  function sortByReadingOrder(els) {
    const ROW_OVERLAP_THRESHOLD = 0.5;
    function verticalOverlap(a, b) {
      const aBottom = a.top + a.height;
      const bBottom = b.top + b.height;
      const overlap = Math.min(aBottom, bBottom) - Math.max(a.top, b.top);
      if (overlap <= 0) return 0;
      return overlap / Math.min(a.height, b.height);
    }
    const byTop = els.slice().sort((a, b) => a.top - b.top);
    const rows = [];
    for (const element of byTop) {
      const row = rows[rows.length - 1];
      const joins = row && row.some((existing) => verticalOverlap(existing, element) >= ROW_OVERLAP_THRESHOLD);
      if (joins) row.push(element);
      else rows.push([element]);
    }
    const out = [];
    for (const row of rows) {
      row.sort((a, b) => a.left - b.left);
      out.push(...row);
    }
    return out;
  }

  /**
   * `selectable` is calibrated for choosing a TAP TARGET: it requires a label, because tapping
   * an unlabelled container would record a useless point selector. Maestro Studio's "show all"
   * inspector is a different question - "what is on this screen at all" - and answers it for
   * images, headings and containers with no label just as much as buttons. So show-all uses
   * its own, much looser filter: everything with real geometry, excluding only the one giant
   * box that would otherwise wrap the entire screen and swallow everything inside it.
   */
  function nearFullscreen(e) {
    return e.width * e.height > 0.9;
  }

  function renderOverlay() {
    overlay.innerHTML = '';
    const shown = showAllElements ? elements.filter((e) => !nearFullscreen(e)) : elements.filter((e) => e.selectable);

    const numberOf = new Map();
    if (showAllElements) {
      sortByReadingOrder(shown).forEach((e, i) => numberOf.set(e.elementId, i + 1));
    }

    for (const e of shown) {
      const box = document.createElement('div');
      box.className = 'element-box' + (showAllElements ? ' show-all' : '');
      box.dataset.id = e.elementId;
      box.style.left = e.left * 100 + '%';
      box.style.top = e.top * 100 + '%';
      box.style.width = e.width * 100 + '%';
      box.style.height = e.height * 100 + '%';
      if (showAllElements) {
        const badge = document.createElement('span');
        badge.className = 'element-badge';
        badge.textContent = String(numberOf.get(e.elementId));
        box.appendChild(badge);
      }
      overlay.appendChild(box);
    }

    // Self-report, so "nothing is highlighted" is never ambiguous again: 0 received means
    // detection is failing, received-but-0-drawn means the filter is wrong, and drawn-but-
    // invisible means CSS. If this readout is missing entirely, the panel is running a stale
    // cached build and nothing else here can be trusted.
    const readout = document.getElementById('element-count');
    if (readout) {
      readout.textContent = elements.length + ' found / ' + shown.length + ' shown';
    }

    if (hoveredElement) updateHover(hoveredElement);
  }

  const showAllBtn = document.getElementById('show-all-btn');
  if (showAllBtn) {
    showAllBtn.addEventListener('click', () => {
      showAllElements = !showAllElements;
      showAllBtn.setAttribute('aria-pressed', String(showAllElements));
      renderOverlay();
    });
  }

  function showStatus(text) {
    status.textContent = text;
    status.style.display = 'block';
    setTimeout(() => { status.style.display = 'none'; }, 2000);
  }

  function elementLabel(e) {
    return e.text || e.resourceId || e.contentDesc || '(unnamed)';
  }

  function updateHover(e) {
    hoveredElement = e;
    const selection = document.getElementById('selection');
    const badge = document.getElementById('selection-badge');
    if (e) {
      selection.style.left = e.left * 100 + '%';
      selection.style.top = e.top * 100 + '%';
      selection.style.width = e.width * 100 + '%';
      selection.style.height = e.height * 100 + '%';
      badge.textContent = elementLabel(e);
      selection.classList.add('show');
    } else {
      selection.classList.remove('show');
    }
    for (const el of overlay.children) {
      el.classList.toggle('hover', el.dataset.id === String(e && e.elementId));
    }
  }

  let gesture = null;

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (!frameLoaded) return;
    if (!hierarchyReady) {
      showStatus('Waiting for element detection. The mirror will reconnect automatically.');
      return;
    }
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
    // Smallest labeled element under the cursor wins, like Maestro Studio. The outline plus
    // its badge is the whole hover affordance - no detail panel over the mirror.
    updateHover(elementAt(p.xPct, p.yPct));
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
    // A plain tap on the soft keyboard types on the device but is never recorded - the IME
    // has no hierarchy nodes, so any selector would be a guess. Swipes still pass through
    // (gesture typing, and swiping down to dismiss the keyboard).
    if (!gesture.moved && !gesture.held && inKeyboard(p.xPct, p.yPct)) {
      vscode.postMessage({ type: 'keyboardTap', xPct: p.xPct, yPct: p.yPct });
      lastTapTime = now;
      gesture = null;
      showTapDot(p);
      return;
    }
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

  // --- Android nav bar ---
  // Reload is handled entirely by the panel (re-poll frame + hierarchy); the rest inject a
  // keycode and, for Back/Home only, append a Maestro step.
  const deviceNav = document.getElementById('device-nav');
  if (deviceNav) {
    deviceNav.addEventListener('click', (e) => {
      const button = e.target.closest('button[data-nav]');
      if (!button) return;
      vscode.postMessage({ type: 'nav', action: button.dataset.nav });
    });
  }


  // --- Mirror zoom ---
  // Scaling #stage keeps every overlay correct: element boxes, the selection and the keyboard
  // mask are all positioned in percentages, and taps are already reported as fractions.
  const ZOOM_STEPS = [25, 50, 75, 100, 125, 150, 200];
  const DEFAULT_ZOOM = 50;
  const stage = document.getElementById('stage');
  const zoomLabel = document.getElementById('zoom-label');
  let zoom = DEFAULT_ZOOM;

  function applyZoom() {
    if (!stage) return;
    // A class, not an inline-style probe: the canvas rule must key off zoom state directly.
    stage.classList.add('zoomed');
    stage.style.width = zoom + '%';
    if (zoomLabel) zoomLabel.textContent = zoom + '%';
    try {
      vscode.setState(Object.assign({}, vscode.getState() || {}, { zoom: zoom }));
    } catch (_) {
      // State is a convenience only.
    }
  }

  function stepZoom(direction) {
    let i = ZOOM_STEPS.indexOf(zoom);
    if (i === -1) i = ZOOM_STEPS.indexOf(DEFAULT_ZOOM);
    zoom = ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, i + direction))];
    applyZoom();
  }

  const zoomBar = document.getElementById('zoom-controls');
  if (zoomBar) {
    zoomBar.addEventListener('click', (e) => {
      const button = e.target.closest('button[data-zoom]');
      if (!button) return;
      if (button.dataset.zoom === 'in') stepZoom(1);
      else if (button.dataset.zoom === 'out') stepZoom(-1);
    });
  }

  try {
    const saved = vscode.getState();
    // A panel that last ran with the old Fit mode has 'fit' persisted; that is no longer a
    // valid width, so anything but a known step falls back to the default.
    if (saved && ZOOM_STEPS.indexOf(saved.zoom) !== -1) zoom = saved.zoom;
  } catch (_) {
    // Ignore unreadable state.
  }
  applyZoom();

  // --- Right-click context menu ---
  const contextMenu = document.getElementById('context-menu');
  let menuTarget = null;
  let menuOpener = null;
  const elementPicker = document.getElementById('element-picker');
  const elementActions = document.getElementById('element-actions');
  let pickerSignature = '';

  function elementKey(e) {
    return JSON.stringify([e.selector, e.left, e.top, e.width, e.height]);
  }

  function renderElementPicker() {
    const choices = sortByReadingOrder(elements.filter((e) => !nearFullscreen(e)));
    const signature = JSON.stringify(choices);
    if (signature === pickerSignature) return;
    pickerSignature = signature;
    // A new hierarchy can reuse an id for a different element; discard open stale actions.
    hideMenu();
    const previous = elementPicker.value;
    elementPicker.replaceChildren();
    for (const [index, e] of choices.entries()) {
      const option = document.createElement('option');
      option.value = elementKey(e);
      option.textContent = `${index + 1}. ${elementLabel(e)}${e.className ? ' · ' + e.className : ''}`;
      elementPicker.appendChild(option);
    }
    elementPicker.disabled = choices.length === 0;
    elementActions.disabled = choices.length === 0;
    if (!choices.length) {
      const option = document.createElement('option');
      option.textContent = hierarchyReady ? 'No elements detected' : 'Waiting for element detection…';
      elementPicker.appendChild(option);
    } else if (choices.some((e) => elementKey(e) === previous)) {
      elementPicker.value = previous;
    }
  }

  elementPicker.addEventListener('change', () => {
    updateHover(elements.find((e) => elementKey(e) === elementPicker.value));
  });
  elementActions.addEventListener('click', (event) => {
    event.stopPropagation();
    menuTarget = elements.find((e) => elementKey(e) === elementPicker.value);
    if (!menuTarget) return;
    updateHover(menuTarget);
    const bounds = elementActions.getBoundingClientRect();
    showMenu(bounds.left, bounds.bottom);
  });

  function menuItem(label, onClick, extraClass) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'menu-item' + (extraClass ? ' ' + extraClass : '');
    item.textContent = label;
    item.addEventListener('click', () => { hideMenu(); onClick(); });
    return item;
  }

  /** A button that stays in an open group rather than closing the menu (paired with a field). */
  function menuAction(label, onClick) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'menu-item menu-action';
    item.textContent = label;
    item.addEventListener('click', onClick);
    return item;
  }

  function menuField(placeholder, type, value) {
    const input = document.createElement('input');
    input.type = type || 'text';
    input.placeholder = placeholder || '';
    if (placeholder) input.setAttribute('aria-label', placeholder);
    if (value !== undefined) input.value = value;
    // Typing in a field must not bubble out and close the menu.
    input.addEventListener('click', (e) => e.stopPropagation());
    return input;
  }

  /** A row of small buttons - used for the element gestures, which are the common case. */
  function menuRow(entries) {
    const row = document.createElement('div');
    row.className = 'menu-row';
    for (const [label, onClick] of entries) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'menu-chip';
      b.textContent = label;
      b.addEventListener('click', () => { hideMenu(); onClick(); });
      row.appendChild(b);
    }
    return row;
  }

  /**
   * A collapsed section. Everything except the element gestures lives in one of these, which
   * keeps the menu short enough not to scroll - it used to be ~35 items deep.
   */
  function menuGroup(title, build) {
    const wrap = document.createElement('div');
    wrap.className = 'menu-group';

    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'menu-group-head';
    head.setAttribute('aria-expanded', 'false');
    head.innerHTML = '<span class="menu-caret">›</span>';
    head.appendChild(document.createTextNode(' ' + title));

    const bodyEl = document.createElement('div');
    bodyEl.className = 'menu-group-body';

    head.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = wrap.classList.toggle('open');
      head.setAttribute('aria-expanded', String(open));
      if (open && !bodyEl.dataset.built) {
        build(bodyEl);
        bodyEl.dataset.built = '1';
      }
      keepMenuOnScreen();
    });

    wrap.appendChild(head);
    wrap.appendChild(bodyEl);
    return wrap;
  }

  function post(msg) {
    vscode.postMessage(msg);
  }

  function targetElement() {
    return menuTarget;
  }

  function elementAction(action) {
    if (!recording && (action === 'assertVisible' || action === 'assertNotVisible')) {
      showStatus('Start recording before adding an assertion.');
      return;
    }
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

    // Header: the label only. It previously appended "[resourceId]" even when the label WAS
    // the resourceId, printing the same long id twice.
    const head = document.createElement('div');
    head.className = 'menu-target';
    if (target) {
      const label = elementLabel(target);
      head.textContent = label;
      if (target.resourceId && target.resourceId !== label) {
        const sub = document.createElement('div');
        sub.className = 'menu-target-sub';
        sub.textContent = target.resourceId;
        head.appendChild(sub);
      }
    } else {
      head.textContent = 'Empty area';
      head.classList.add('menu-target-empty');
    }
    contextMenu.appendChild(head);

    // Element gestures - the reason the menu was opened, so always visible.
    const gestures = document.createElement('div');
    gestures.className = 'menu-gestures';
    gestures.appendChild(
      menuRow([
        ['Tap', () => elementAction('elementTap')],
        ['Long press', () => elementAction('longPress')],
        ['Double tap', () => elementAction('doubleTap')]
      ])
    );
    gestures.appendChild(
      menuRow([
        ['Assert visible', () => elementAction('assertVisible')],
        ['Assert hidden', () => elementAction('assertNotVisible')]
      ])
    );
    contextMenu.appendChild(gestures);

    contextMenu.appendChild(
      menuGroup('Text & keyboard', (b) => {
        const text = menuField('Text to type...');
        b.appendChild(text);
        b.appendChild(
          menuAction('Input text', () => {
            if (!text.value) return;
            const el = targetElement();
            post({ type: 'inputText', text: text.value, elementId: el ? el.elementId : undefined });
            text.value = '';
            hideMenu();
          })
        );
        const erase = menuField('Characters to erase', 'number', '50');
        b.appendChild(erase);
        b.appendChild(
          menuAction('Erase', () => {
            post({ type: 'eraseText', count: parseInt(erase.value, 10) || 50 });
            hideMenu();
          })
        );
        b.appendChild(menuItem('Enter', () => post({ type: 'pressKey', key: 'enter' })));
        b.appendChild(menuItem('Hide keyboard', () => post({ type: 'hideKeyboard' })));
        b.appendChild(menuItem('Paste', () => post({ type: 'pasteText' })));
      })
    );

    contextMenu.appendChild(
      menuGroup('App', (b) => {
        const clear = menuField('', 'checkbox');
        const wrap = document.createElement('label');
        wrap.className = 'menu-item menu-check';
        wrap.appendChild(clear);
        wrap.appendChild(document.createTextNode(' Clear state on launch'));
        b.appendChild(wrap);
        b.appendChild(menuItem('Launch app', () => post({ type: 'launchApp', clearState: clear.checked })));
        b.appendChild(menuItem('Stop app', () => post({ type: 'stopApp' })));
        b.appendChild(menuItem('Kill app', () => post({ type: 'killApp', clearState: clear.checked })));
        b.appendChild(menuItem('Clear app state', () => post({ type: 'clearState' })));
        b.appendChild(menuItem('Toggle dark mode', () => post({ type: 'toggleDarkMode' })));
      })
    );

    contextMenu.appendChild(
      menuGroup('Device', (b) => {
        b.appendChild(menuItem('Landscape', () => post({ type: 'setOrientation', orientation: 'LANDSCAPE' })));
        b.appendChild(menuItem('Portrait', () => post({ type: 'setOrientation', orientation: 'PORTRAIT' })));
        b.appendChild(menuItem('Scroll', () => post({ type: 'scroll' })));
        b.appendChild(menuItem('Toggle airplane mode', () => post({ type: 'toggleAirplaneMode' })));
        const clip = menuField('Clipboard text...');
        b.appendChild(clip);
        b.appendChild(
          menuAction('Set clipboard', () => {
            if (!clip.value) return;
            post({ type: 'setClipboard', text: clip.value });
            clip.value = '';
            hideMenu();
          })
        );
      })
    );

    contextMenu.appendChild(
      menuGroup('Capture', (b) => {
        const shot = menuField('screenshot-name');
        b.appendChild(shot);
        b.appendChild(
          menuAction('Take screenshot', () => {
            post({ type: 'takeScreenshot', name: shot.value });
            shot.value = '';
            hideMenu();
          })
        );
      })
    );

    const optional = menuField('', 'checkbox');
    const optWrap = document.createElement('label');
    optWrap.className = 'menu-item menu-check menu-footer';
    optWrap.appendChild(optional);
    optWrap.appendChild(document.createTextNode(' Record steps as optional'));
    optional.addEventListener('change', () => post({ type: 'optional', value: optional.checked }));
    contextMenu.appendChild(optWrap);
  }
  /**
   * Places the menu at the cursor, then keeps it inside the viewport. Right-clicking near
   * the right or bottom edge used to push the menu off-screen, where it was unreachable.
   * The menu must be un-hidden before measuring: display:none reports a zero-size rect.
   */
  let menuAnchor = { x: 0, y: 0 };

  function showMenu(x, y) {
    menuOpener = document.activeElement;
    menuAnchor = { x, y };
    buildMenu();
    contextMenu.classList.remove('hidden');
    contextMenu.classList.add('show');
    keepMenuOnScreen();
    contextMenu.querySelector('button')?.focus();
  }

  /** Re-run after the menu changes size, e.g. when a group is expanded. */
  function keepMenuOnScreen() {
    contextMenu.style.left = '0px';
    contextMenu.style.top = '0px';

    const menu = contextMenu.getBoundingClientRect();
    const margin = 8;
    const maxLeft = window.innerWidth - menu.width - margin;
    const maxTop = window.innerHeight - menu.height - margin;

    // Prefer flipping to the left of the cursor when it would overflow; clamp as a backstop
    // so the menu stays on screen even when it is wider or taller than the panel.
    let left = menuAnchor.x;
    if (menuAnchor.x > maxLeft) left = Math.max(margin, menuAnchor.x - menu.width);
    let top = menuAnchor.y;
    if (menuAnchor.y > maxTop) top = Math.max(margin, menuAnchor.y - menu.height);

    contextMenu.style.left = Math.max(margin, Math.min(left, Math.max(margin, maxLeft))) + 'px';
    contextMenu.style.top = Math.max(margin, Math.min(top, Math.max(margin, maxTop))) + 'px';
  }

  function hideMenu() {
    const hadFocus = contextMenu.contains(document.activeElement);
    contextMenu.classList.add('hidden');
    contextMenu.classList.remove('show');
    if (hadFocus && menuOpener) menuOpener.focus();
  }

  contextMenu.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      hideMenu();
    }
  });
  contextMenu.addEventListener('focusout', () => {
    setTimeout(() => {
      if (!contextMenu.contains(document.activeElement)) hideMenu();
    }, 0);
  });

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
