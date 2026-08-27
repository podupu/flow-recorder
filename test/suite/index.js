const vscode = require('vscode');
const path = require('path');
const fs = require('fs');

const DONE_MARKER = process.env.FLOW_RECORDER_DONE_MARKER;
const FLOW_PATH = process.env.FLOW_RECORDER_FLOW_PATH;

function waitForMarker(timeoutMs) {
  const start = Date.now();
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      if (fs.existsSync(DONE_MARKER) || Date.now() - start > timeoutMs) {
        clearInterval(timer);
        resolve();
      }
    }, 300);
  });
}

async function run() {
  console.log('[driver] activating: opening', FLOW_PATH);
  const uri = vscode.Uri.file(FLOW_PATH);
  await vscode.commands.executeCommand('vscode.open', uri);
  await new Promise((r) => setTimeout(r, 800));

  const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
  console.log('[driver] active tab after open:', tab && tab.label);

  console.log('[driver] invoking flowRecorder.startAndroidMirror');
  await vscode.commands.executeCommand('flowRecorder.startAndroidMirror');
  console.log('[driver] command dispatched, window should show the mirror panel now');

  console.log('[driver] keeping Extension Development Host alive, waiting for marker file:', DONE_MARKER);
  await waitForMarker(180000);
  console.log('[driver] marker seen (or timed out), exiting run()');
}

module.exports = { run };
