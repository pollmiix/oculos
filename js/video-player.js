(() => {
  window.iniciarVideoLoja = (video, { container = video?.parentElement, button, permitido = () => true } = {}) => {
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
    video.playsInline = true;
    video.setAttribute('muted', '');
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    const showButton = show => { if (button) button.hidden = !show; };
    const atualizar = () => {
      if (!allowed()) {
        video.autoplay = false;
        video.pause();
        showButton(false);
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
      pending = true;
      try {
        const playback = video.play();
        Promise.resolve(playback).then(() => {
          gestureNeeded = false;
          showButton(false);
          // A checkout or tab change can happen while play() is pending.
          if (!allowed()) { video.autoplay = false; video.pause(); }
        }).catch(error => {
          if (error.name === 'AbortError' && !allowed()) return;
          gestureNeeded = true;
          showButton(allowed());
        }).finally(() => { pending = false; });
      } catch {
        pending = false;
        gestureNeeded = true;
        showButton(true);
      }
    };
    const retry = () => {
      if (video.error) {
        sourceLoaded = false;
        video.load();
      }
      atualizar();
    };
    button?.addEventListener('click', retry);
    video.addEventListener('playing', () => {
      gestureNeeded = false;
      showButton(false);
    });
    video.addEventListener('error', () => {
      pending = false;
      gestureNeeded = true;
      showButton(allowed());
    });
    video.addEventListener('canplay', atualizar);
    document.addEventListener('visibilitychange', atualizar);
    document.addEventListener('pointerup', () => { if (gestureNeeded) retry(); }, { passive: true });
    document.addEventListener('keydown', event => { if (gestureNeeded && ['Enter', ' '].includes(event.key)) retry(); });
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
    button: document.getElementById('heroVideoPlay'),
    permitido: () => !document.documentElement.classList.contains('checkout-loading')
      && !document.getElementById('checkout')?.classList.contains('aberto')
  });
})();
