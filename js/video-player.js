(() => {
  window.iniciarVideoLoja = (video, { container = video?.parentElement, permitido = () => true } = {}) => {
    if (!video || !container) return null;
    if (video.lojaPlayer) return video.lojaPlayer;
    let pending = false;
    let gestureNeeded = false;
    let sourceLoaded = false;
    const visible = () => {
      const rect = container.getBoundingClientRect();
      return !container.hidden && rect.width > 0 && rect.height > 0
        && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
    };
    const allowed = () => !document.hidden && permitido() && visible();
    video.muted = true;
    video.defaultMuted = true;
    video.loop = true;
    video.controls = false;
    video.playsInline = true;
    video.setAttribute('muted', '');
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    const atualizar = () => {
      if (!allowed()) {
        video.autoplay = false;
        video.pause();
        return;
      }
      if (pending || (!video.paused && !video.ended)) return;
      if (!sourceLoaded) {
        video.querySelectorAll('source[data-src]').forEach(source => { source.src = source.dataset.src; });
        sourceLoaded = true;
        video.preload = 'auto';
        video.load();
      }
      video.muted = true;
      video.autoplay = true;
      if (video.ended) video.currentTime = 0;
      pending = true;
      try {
        const playback = video.play();
        Promise.resolve(playback).then(() => {
          gestureNeeded = false;
          // A checkout or tab change can happen while play() is pending.
          if (!allowed()) { video.autoplay = false; video.pause(); }
        }).catch(error => {
          if (error.name === 'AbortError' && !allowed()) return;
          gestureNeeded = true;
        }).finally(() => { pending = false; });
      } catch {
        pending = false;
        gestureNeeded = true;
      }
    };
    const retry = () => {
      if (video.error) {
        sourceLoaded = false;
        video.load();
      }
      atualizar();
    };
    video.addEventListener('playing', () => {
      gestureNeeded = false;
    });
    video.addEventListener('error', () => {
      pending = false;
      gestureNeeded = true;
    });
    video.addEventListener('pause', () => {
      if (allowed() && !gestureNeeded) requestAnimationFrame(atualizar);
    });
    video.addEventListener('ended', atualizar);
    video.addEventListener('canplay', atualizar);
    document.addEventListener('visibilitychange', atualizar);
    const retomarNoGesto = () => {
      if (allowed() && video.paused) retry();
    };
    // Scrolling on a touch screen can cancel pointerup and never generate click.
    // Call play synchronously in touchend so Safari can use that user gesture.
    document.addEventListener('touchend', retomarNoGesto, { passive: true });
    document.addEventListener('pointerup', retomarNoGesto, { passive: true });
    document.addEventListener('click', retomarNoGesto, { passive: true });
    document.addEventListener('keydown', event => { if (['Enter', ' '].includes(event.key)) retomarNoGesto(); });
    window.addEventListener('pageshow', atualizar);
    window.addEventListener('resize', atualizar);
    if (typeof IntersectionObserver === 'function') {
      new IntersectionObserver(atualizar, { threshold: [0, 0.01], rootMargin: '0px' }).observe(container);
    } else {
      window.addEventListener('scroll', atualizar, { passive: true });
    }
    video.lojaPlayer = { atualizar };
    atualizar();
    return video.lojaPlayer;
  };
  const hero = document.querySelector('.hero-video');
  if (hero) window.videoCapaLoja = window.iniciarVideoLoja(hero, {
    container: hero.closest('.hero'),
    permitido: () => !document.documentElement.classList.contains('checkout-loading')
      && !document.getElementById('checkout')?.classList.contains('aberto')
  });
})();
