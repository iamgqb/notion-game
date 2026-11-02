const test = require('node:test');
const assert = require('node:assert/strict');
const { imageSources } = require('../site/game-artwork');

const artwork = {
    hero: 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/570/hero-hash/library_hero.jpg?t=1',
    portrait: 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/570/capsule-hash/library_capsule_schinese.jpg?t=1',
    header: 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/570/header-hash/header_schinese.jpg?t=1',
};

test('竖版容器优先使用接口返回的竖版图，整个回退链不会混入 hero 或横幅', () => {
    const sources = imageSources(570, artwork);
    assert.equal(sources[0], artwork.portrait);
    assert.ok(sources.every((source) => /library_(capsule|600x900)/.test(source)));
    assert.ok(!sources.includes(artwork.hero));
    assert.ok(!sources.includes(artwork.header));
});

test('首页宽幅主视觉使用 hero，横向列表缩略图使用商店横幅', () => {
    const heroSources = imageSources(570, artwork, 'hero');
    const headerSources = imageSources(570, artwork, 'header');
    assert.equal(heroSources[0], artwork.hero);
    assert.ok(heroSources.includes(artwork.header));
    assert.equal(headerSources[0], artwork.header);
    assert.ok(headerSources.every((source) => /header/.test(source)));
    assert.ok(!heroSources.includes(artwork.portrait));
    assert.ok(!headerSources.includes(artwork.portrait));
});

test('缺少资源元数据仍按方向回退，重复地址只尝试一次', () => {
    const portraitSources = imageSources(570, null);
    assert.ok(portraitSources.every((source) => /library_600x900/.test(source)));
    assert.ok(imageSources(570, null, 'hero')[0].endsWith('/library_hero.jpg'));
    assert.ok(imageSources(570, null, 'header')[0].endsWith('/header.jpg'));
    assert.deepEqual(imageSources(570, { portrait: portraitSources[0] }), portraitSources);
});
