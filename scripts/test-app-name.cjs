const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
const name = '\u5263\u9053\u5352\u7814';
assert.equal(manifest.name, name);
assert.equal(manifest.short_name, name);
assert.equal(manifest.start_url, './index.html');
assert.equal(manifest.scope, './');
assert.equal(html.match(/<title>([^<]*)<\/title>/)[1], name);
for (const meta of ['application-name', 'apple-mobile-web-app-title']) {
    assert.ok(html.includes(`<meta name="${meta}" content="${name}">`));
}
assert.ok(html.includes(`>${name}</span>`));
assert.ok(html.includes(`workbook.creator = '${name}'`));
assert.ok(!html.includes('Kendo Virtual Coach'));
assert.ok(html.includes("safeStorageSet('kendoRecords',"), 'existing record key remains unchanged');
for (const file of ['research/index.html', 'research/history.html']) {
    const page = fs.readFileSync(path.join(root, file), 'utf8');
    assert.ok(page.match(/<title>([^<]*)<\/title>/)[1].includes(name));
    assert.ok(page.includes(`<span>${name}</span>`));
    assert.ok(!page.includes('Kendo Virtual Coach'));
}
for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/\bsrc\s*=|type=["'](?:module|application\/)/i.test(match[1])) new vm.Script(match[2]);
}
console.log('PASS: app title, manifest, home-screen name, export name, record compatibility and syntax');
