import 'whatwg-fetch';
import './domrect-polyfill';

import { handleLaunch } from './utils';

document.addEventListener(
  'webOSRelaunch',
  (evt) => {
    console.info('RELAUNCH:', evt, window.launchParams);
    handleLaunch(evt.detail);
  },
  true
);

import './app_api/index';
import './adblock.js';
import './hooks/json-stringify';
import './shorts.js';
import './sponsorblock.js';
import './ui.js';
import './font-fix.css';
import './thumbnail-quality';
import './screensaver-fix';
import './yt-fixes.css';
import './watch.js';
import './video-quality';
import './lang-settings-fix';
import './remove-endscreen';
import './hooks';
import './block-webos-cast';
import './auto-account-select';

// === CONTROLE DE VELOCIDADE AVANÇADO PARA YOUTUBE WEBOS ===
(function () {
  let targetSpeed = 1.0;
  const speeds = [1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0];

  const nativePlaybackRateDescriptor = Object.getOwnPropertyDescriptor(
    HTMLMediaElement.prototype,
    'playbackRate'
  );

  function getActiveVideo() {
    const videos = Array.from(document.querySelectorAll('video'));
    return (
      videos.find((v) => !v.paused && v.readyState > 2) ||
      videos.find((v) => v.src && v.src.length > 0) ||
      videos[0]
    );
  }

  function applySpeed() {
    let actualRate = targetSpeed;

    // 1. Tenta pela API interna do player do YouTube
    const ytPlayer = document.getElementById('movie_player');
    if (ytPlayer && typeof ytPlayer.setPlaybackRate === 'function') {
      try {
        ytPlayer.setPlaybackRate(targetSpeed);
      } catch (err) {}
    }

    // 2. Força diretamente no motor HTML5 da TV e trava alterações externas
    const videos = document.querySelectorAll('video');
    videos.forEach((video) => {
      try {
        // Desativa correção de tom se passar de 2x para evitar travamento do decodificador da LG
        if (targetSpeed > 2.0) {
          if ('preservesPitch' in video) video.preservesPitch = false;
          if ('webkitPreservesPitch' in video) video.webkitPreservesPitch = false;
        } else {
          if ('preservesPitch' in video) video.preservesPitch = true;
          if ('webkitPreservesPitch' in video) video.webkitPreservesPitch = true;
        }

        if (nativePlaybackRateDescriptor && nativePlaybackRateDescriptor.set) {
          nativePlaybackRateDescriptor.set.call(video, targetSpeed);

          if (!video.__speedLocked) {
            Object.defineProperty(video, 'playbackRate', {
              configurable: true,
              get: function () {
                return nativePlaybackRateDescriptor.get.call(this);
              },
              set: function () {
                nativePlaybackRateDescriptor.set.call(this, targetSpeed);
              }
            });
            video.__speedLocked = true;
          }
        } else {
          video.playbackRate = targetSpeed;
        }
      } catch (err) {}
    });

    const activeVid = getActiveVideo();
    if (activeVid && nativePlaybackRateDescriptor && nativePlaybackRateDescriptor.get) {
      actualRate = nativePlaybackRateDescriptor.get.call(activeVid);
    }

    return actualRate;
  }

  function showSpeedToast(speed, actual) {
    let toast = document.getElementById('custom-speed-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'custom-speed-toast';
      toast.style.cssText =
        'position:fixed;top:40px;right:40px;background:rgba(0,0,0,0.9);color:#fff;padding:16px 28px;border-radius:12px;font-size:30px;font-weight:bold;z-index:2147483647;font-family:sans-serif;pointer-events:none;transition:opacity 0.3s;border:2px solid #00e676;';
      (document.body || document.documentElement).appendChild(toast);
    }
    toast.textContent = `Velocidade: ${speed}x (Ativo: ${actual}x)`;
    toast.style.opacity = '1';
    clearTimeout(window.__speedToastTimer);
    window.__speedToastTimer = setTimeout(() => {
      toast.style.opacity = '0';
    }, 2500);
  }

  document.addEventListener(
    'ratechange',
    function (e) {
      if (e.target && e.target.tagName === 'VIDEO') {
        const current = nativePlaybackRateDescriptor
          ? nativePlaybackRateDescriptor.get.call(e.target)
          : e.target.playbackRate;
        if (Math.abs(current - targetSpeed) > 0.01) {
          applySpeed();
        }
      }
    },
    true
  );

  document.addEventListener('playing', applySpeed,
