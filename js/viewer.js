/* =========================================================================
   Kitogram 4.0 — просмотрщик медиа (фото / GIF / видео)
   ========================================================================= */
(function (KG) {
  'use strict';
  const { $ } = KG;

  const Viewer = {
    image(src) {
      const img = $('image-view');
      if (!img || !src) return;
      img.src = src;
      const dl = $('image-download');
      if (dl) dl.href = src;
      KG.openModal('image-modal');
    },
    video(src) {
      const v = $('video-view');
      if (!v || !src) return;
      v.src = src;
      KG.openModal('video-modal');
      const p = v.play();
      if (p && p.catch) p.catch(() => {});
    }
  };

  KG.Viewer = Viewer;
})(window.KG);
