(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CheckpointArtwork = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  // 资源缺失时也保持容器方向，避免把横向主视觉裁成竖版封面。
  function imageSources(appid, artwork, kind = 'portrait') {
    const base = `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${Number(appid)}`;
    let sources;
    if (kind === 'portrait') {
      sources = [artwork?.portrait, `${base}/library_600x900.jpg`, `${base}/library_600x900_2x.jpg`];
    } else if (kind === 'header') {
      sources = [artwork?.header, `${base}/header.jpg`];
    } else {
      sources = [artwork?.hero, `${base}/library_hero.jpg`, artwork?.header, `${base}/header.jpg`];
    }
    return [...new Set(sources.filter(Boolean))];
  }

  return { imageSources };
});
