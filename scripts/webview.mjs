// Builds media/webview/panel.js from src/webview into one IIFE, the script the panel loads with its nonce.
// `--watch` rebuilds on every save. The output is not in git: `npm run compile` and `vsce package` rebuild it.
import { build, context } from 'esbuild';

const options = {
  entryPoints: ['src/webview/main.ts'],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  charset: 'utf8',
  logLevel: 'warning',
  outfile: 'media/webview/panel.js',
  banner: { js: '// Generated from src/webview by `npm run webview`. Edit the modules there: this file is rebuilt and not in git.' },
};

if (process.argv.includes('--watch')) {
  const ctx = await context(options);
  await ctx.watch();
  console.log('watching src/webview');
} else await build(options);
