const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const styles = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)]
    .map(match => match[1]).join('\n');

// A horizontal scroll container also clips the dropdown in the vertical axis.
const stripRules = [...styles.matchAll(/(?:^|\n)\s*(?:body\.measurement-simple\s+)?\.kvc-tab-strip\s*\{([^}]*)\}/g)];
assert.ok(stripRules.length > 0, 'navigation styles are present');
assert.match(stripRules[0][1], /\boverflow\s*:\s*visible\s*;/,
    'desktop navigation must let the More menu extend outside the tab strip');
for (const [, declarations] of stripRules) {
    for (const [, value] of declarations.matchAll(/\boverflow(?:-[xy])?\s*:\s*([^;]+);/g)) {
        assert.equal(value.trim(), 'visible', 'responsive navigation must not clip the dropdown');
    }
}

const summaryRule = styles.match(/(?:^|\n)\s*\.kvc-more-nav-button\s*\{([^}]*)\}/);
assert.ok(summaryRule, 'More button has its own sizing rule');
assert.match(summaryRule[1], /\bwidth\s*:\s*100%\s*;/,
    'the entire mobile navigation cell must be a tap target');

const navLayer = styles.match(/(?:^|\n)\s*\.kvc-app-nav\s*\{[^}]*z-index:\s*(\d+)/);
assert.ok(navLayer, 'navigation owns a layer above the video workflow toolbar');
for (const [, declarations] of styles.matchAll(/[^{}]*\.video-workflow-tabs\s*\{([^}]*)\}/g)) {
    const toolbarLayer = declarations.match(/z-index:\s*(\d+)/);
    if (toolbarLayer) assert.ok(Number(navLayer[1]) > Number(toolbarLayer[1]),
        'the sticky video workflow toolbar must not cover submenu buttons');
}

const menu = html.match(/<details\b[^>]*\bid="moreNavMenu"[^>]*>([\s\S]*?)<\/details>/);
assert.ok(menu, 'More remains a native keyboard-accessible disclosure');
assert.match(menu[1], /<summary\b/);
for (const [, tab] of menu[1].matchAll(/data-kendo-action="switch-tab"\s+data-value="([^"]+)"/g)) {
    assert.ok(html.includes(`id="tab-${tab}"`), `More destination exists: ${tab}`);
}
assert.match(menu[1], /href="\.\/research\/"/);
console.log('PASS: unclipped navigation, full-width More tap target and submenu destinations');
