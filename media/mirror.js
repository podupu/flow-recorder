(function () {
  const vscode = acquireVsCodeApi();
  const canvas = document.getElementById('screen');
  const ctx = canvas.getContext('2d');
  const status = document.getElementById('status');
  const img = new Image();
  let frameLoaded = false;

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
    }
  });

  canvas.addEventListener('click', (e) => {
    if (!frameLoaded) return;
    const rect = canvas.getBoundingClientRect();
    const xPct = (e.clientX - rect.left) / rect.width;
    const yPct = (e.clientY - rect.top) / rect.height;
    vscode.postMessage({ type: 'tap', xPct, yPct });

    const dot = document.createElement('div');
    dot.className = 'tap-dot';
    dot.style.left = e.clientX + 'px';
    dot.style.top = e.clientY + 'px';
    document.body.appendChild(dot);
    setTimeout(() => dot.remove(), 300);
  });
})();
