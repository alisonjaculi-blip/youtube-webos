import { configRead } from './config';
import { getPlayerManager, PlayerMode } from './player_api';
import { showNotification } from './ui';

const STORAGE_KEY = 'ytaf-playback-speed';
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];

const nativeRateDescriptor = Object.getOwnPropertyDescriptor(
  HTMLMediaElement.prototype,
  'playbackRate'
);

const playerManager = await getPlayerManager();

function loadSpeed(): number {
  try {
    const stored = Number(window.localStorage.getItem(STORAGE_KEY));
    if (SPEEDS.includes(stored)) return stored;
  } catch {
    // ignore, fall through to default
  }
  return 1;
}

let desiredRate = loadSpeed();
let qualityPollToken: number | undefined;

function speedEnabled() {
  try {
    const val = configRead('enablePlaybackSpeed');
    return val !== undefined ? Boolean(val) : true;
  } catch {
    return true;
  }
}

function keepQuality() {
  try {
    return Boolean(configRead('keepQualityOnSpeed'));
  } catch {
    return true;
  }
}

function getVideos(): HTMLVideoElement[] {
  return Array.from(document.querySelectorAll('video'));
}

function getVideo(): HTMLVideoElement | null {
  const videos = getVideos();
  return (
    videos.find((v) => !v.paused && v.readyState > 2) ||
    videos.find((v) => v.src && v.src.length > 0) ||
    videos[0] ||
    null
  );
}

function canControl() {
  return speedEnabled() && getVideo() !== null;
}

function getMaxQualityLabel() {
  try {
    return playerManager.player.getAvailableQualityData()?.[0]?.qualityLabel;
  } catch {
    return undefined;
  }
}

function pinQuality() {
  if (!keepQuality() || desiredRate === 1) return;

  try {
    const player = playerManager.player;
    const max = getMaxQualityLabel();
    if (!max) return;

    if (player.getPlaybackQualityLabel() !== max) {
      player.setPlaybackQualityRange('highres', 'highres');
    }
  } catch {
    // ignore if player API is not ready
  }
}

function startQualityPoll() {
  if (qualityPollToken !== undefined) return;

  qualityPollToken = window.setInterval(() => {
    if (desiredRate === 1 || !canControl()) {
      stopQualityPoll();
      return;
    }
    pinQuality();
  }, 1500);
}

function stopQualityPoll() {
  if (qualityPollToken === undefined) return;
  clearInterval(qualityPollToken);
  qualityPollToken = undefined;
}

function setNativeVideoRate(video: HTMLVideoElement, rate: number) {
  try {
    // No webOS, desativar preservesPitch acima de 2x ajuda o decodificador de áudio a não travar
    const anyVid = video as any;
    const preserve = rate <= 2.0;
    if ('preservesPitch' in anyVid) anyVid.preservesPitch = preserve;
    if ('webkitPreservesPitch' in anyVid) anyVid.webkitPreservesPitch = preserve;

    if (nativeRateDescriptor && nativeRateDescriptor.set && nativeRateDescriptor.get) {
      nativeRateDescriptor.set.call(video, rate);

      // Bloqueia o YouTube de resetar o playbackRate de volta para 1x
      if (!anyVid.__ytafSpeedHooked) {
        Object.defineProperty(video, 'playbackRate', {
          configurable: true,
          get() {
            return nativeRateDescriptor.get!.call(this);
          },
          set(newVal: number) {
            const target = speedEnabled() ? desiredRate : newVal;
            nativeRateDescriptor.set!.call(this, target);
          }
        });
        anyVid.__ytafSpeedHooked = true;
      }
    } else {
      video.playbackRate = rate;
    }
  } catch (err) {
    console.debug('[playback-speed] setNativeVideoRate error', err);
  }
}

function getActualVideoRate(video: HTMLVideoElement | null): number {
  if (!video) return desiredRate;
  try {
    if (nativeRateDescriptor && nativeRateDescriptor.get) {
      return Number(nativeRateDescriptor.get.call(video).toFixed(2));
    }
    return Number(video.playbackRate.toFixed(2));
  } catch {
    return desiredRate;
  }
}

function applyRate() {
  if (!canControl()) return;

  const videos = getVideos();
  if (videos.length === 0) return;

  const target = speedEnabled() ? desiredRate : 1;

  for (const video of videos) {
    setNativeVideoRate(video, target);
  }

  if (target !== 1) {
    pinQuality();
    startQualityPoll();
  } else {
    stopQualityPoll();
  }
}

function setSpeed(rate: number) {
  desiredRate = rate;

  try {
    window.localStorage.setItem(STORAGE_KEY, String(rate));
  } catch {
    // ignore
  }

  applyRate();
  const actual = getActualVideoRate(getVideo());
  showNotification(`Velocidade: ${rate}x (Real: ${actual}x)`, 2000);
}

function stepSpeed(direction: 1 | -1) {
  const index = SPEEDS.indexOf(desiredRate);
  const currentIdx = index === -1 ? SPEEDS.indexOf(1) : index;
  const next =
    SPEEDS[Math.min(Math.max(currentIdx + direction, 0), SPEEDS.length - 1)];
  if (next === undefined) return;
  setSpeed(next);
}

function handleRateChange(evt: Event) {
  if (!(evt.target instanceof HTMLVideoElement)) return;
  if (!canControl()) return;

  const current = getActualVideoRate(evt.target);
  if (Math.abs(current - desiredRate) > 0.01) {
    setNativeVideoRate(evt.target, desiredRate);
  }
}

function isOptionsPanelOpen() {
  const panel = document.querySelector<HTMLElement>('.ytaf-ui-container');
  return panel !== null && panel.style.display !== 'none';
}

// Botão Vermelho (403) = Diminui | Botão Amarelo (405 / 170) = Aumenta
function handleKey(evt: KeyboardEvent) {
  const code = evt.keyCode || evt.charCode;
  const isRed = code === 403;
  const isYellow = code === 405 || code === 170;
  if (!isRed && !isYellow) return;
  if (isOptionsPanelOpen() || !canControl()) return;

  evt.preventDefault();
  evt.stopPropagation();

  if (evt.type === 'keydown') {
    stepSpeed(isYellow ? 1 : -1);
  }
}

document.addEventListener('ratechange', handleRateChange, true);
document.addEventListener('loadedmetadata', applyRate, true);
document.addEventListener('playing', applyRate, true);
document.addEventListener('keydown', handleKey, true);
document.addEventListener('keypress', handleKey, true);
document.addEventListener('keyup', handleKey, true);

window.setInterval(applyRate, 1000);

playerManager.addEventListener('newVideo', applyRate);
playerManager.addEventListener('playbackStart', applyRate);
