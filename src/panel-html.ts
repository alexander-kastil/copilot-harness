// The panel's HTML, kept free of the vscode module so a unit test can build it.

export interface PanelHtmlInput {
  /** webview.cspSource */
  cspSource: string;
  nonce: string;
  scriptUri: string;
  styleUri: string;
}

/** A page whose CSP allows only the bundled script (by nonce) and the bundled stylesheet. */
export function panelHtml(i: PanelHtmlInput): string {
  const csp = `default-src 'none'; style-src ${i.cspSource}; script-src 'nonce-${i.nonce}'; img-src ${i.cspSource} data:; font-src ${i.cspSource};`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${i.styleUri}">
<title>Copilot Harness</title>
</head>
<body>
<main id="app"></main>
<script nonce="${i.nonce}" src="${i.scriptUri}"></script>
</body>
</html>`;
}
