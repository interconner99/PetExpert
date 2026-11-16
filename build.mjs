import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile, copyFile } from 'node:fs/promises';

await mkdir('dist/server', { recursive: true });
await mkdir('dist/.openai', { recursive: true });
const result = await build({ entryPoints: ['src/app.jsx'], bundle: true, minify: true, format: 'iife', platform: 'browser', target: 'es2020', write: false, loader: { '.jsx': 'jsx' } });
const js = result.outputFiles[0].text;
const css = await readFile('src/style.css', 'utf8');
const worker = (await build({entryPoints:['src/worker.js'],bundle:true,format:'esm',platform:'browser',target:'es2022',write:false})).outputFiles[0].text;
const operational=await readFile('supabase/migrations/20261113_operational_bridge.sql','utf8');
const migration=await readFile('supabase/migrations/20261113_erp_reports.sql','utf8')+'\n'+operational;
const version=createHash('sha256').update(js+css).digest('hex').slice(0,16);
await writeFile('dist/server/index.js', `const APP_JS=${JSON.stringify(js)};\nconst APP_CSS=${JSON.stringify(css)};\nconst ASSET_VERSION=${JSON.stringify(version)};\nconst MIGRATION_SQL=${JSON.stringify(migration)};\nconst OPERATIONAL_SQL=${JSON.stringify(operational)};\n${worker}`);
await copyFile('.openai/hosting.json', 'dist/.openai/hosting.json');
console.log(`Built Worker; browser bundle ${Math.round(js.length / 1024)} KB`);
