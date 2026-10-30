import { configRead } from './config';
import { getPlayerManager, PlayerMode } from './player_api';
import { showNotification } from './ui';

const STORAGE_KEY = 'ytaf-playback-speed';
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];

// Safety valve in case the app keeps resetting the rate and we keep fighting it.
const MAX_REAPPLY_PER_SECOND = 10;

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
let reapplyCount = 0;
let reapplyWindowStart = 0;
let qualityPollToken: number | undefined;

function speedEnabled() {
  return configRead('enablePlaybackSpeed');
}

function keepQuality() {
  return configRead('keepQualityOnSpeed');
}

function getVideo(): HTMLVideoElement | null {
  return document.querySelector('video');
}

function canControl() {
  return (
    speedEnabled() &&
    getVideo() !== null &&
    playerManager.playerMode === PlayerMode.NORMAL
  );
}

function getMaxQualityLabel() {
  return playerManager.player.getAvailableQualityData()[0]?.qualityLabel;
}

/**
 * The app lowers resolution when the playback rate is above 1x.
 * Pin the quality range to the maximum available while sped up.
 */
function pinQuality() {
  if (!keepQuality() || desiredRate === 1) return;

  const player = playerManager.player;
  const max = getMaxQualityLabel();

  // Quality data is empty until the first `isPlaying` state; the poll below
  // will try again.
  if (!max) return;

  if (player.getPlaybackQualityLabel() !== max) {
    console.debug('[playback-speed] pinning quality to', max);
    player.setPlaybackQualityRange('highres', 'highres');
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

function applyRate() {
  if (!canControl()) return;

  const video = getVideo();
  if (!video) return;

  if (video.playbackRate !== desiredRate) {
    const player = playerManager.player;

    // Prefer the player's own API so its internal state stays consistent,
    // then force the media element in case the call is blocked or missing.
    try {
      player.setPlaybackRate?.(desiredRate);
    } catch (err) {
      console.debug('[playback-speed] player.setPlaybackRate failed', err);
    }

    if (video.playbackRate !== desiredRate) {
      video.playbackRate = desiredRate;
    }
  }

  if (desiredRate !== 1) {
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
    // ignore, persistence is best-effort
  }

  applyRate();
  showNotification(`Velocidade: ${rate}x`, 2000);
}

function stepSpeed(direction: 1 | -1) {
  const index = SPEEDS.indexOf(desiredRate);
  const next =
    SPEEDS[Math.min(Math.max(index + direction, 0), SPEEDS.length - 1)];
  if (next === undefined) return;
  setSpeed(next);
}

// If the app resets the rate (new video, buffering, ...), put it back.
function handleRateChange(evt: Event) {
  if (!(evt.target instanceof HTMLVideoElement)) return;
  if (!canControl()) return;
  if (evt.target.playbackRate === desiredRate) return;

  const now = Date.now();
  if (now - reapplyWindowStart > 1000) {
    reapplyWindowStart = now;
    reapplyCount = 0;
  }
  if (++reapplyCount > MAX_REAPPLY_PER_SECOND) {
    console.warn('[playback-speed] app keeps resetting the rate; giving up');
    return;
  }

  applyRate();
}

function isOptionsPanelOpen() {
  const panel = document.querySelector<HTMLElement>('.ytaf-ui-container');
  return panel !== null && panel.style.display !== 'none';
}

// Remote control colour buttons: red = slower, yellow = faster.
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

// Media events don't bubble, so listen in the capture phase.
document.addEventListener('ratechange', handleRateChange, true);
document.addEventListener('loadedmetadata', applyRate, true);
document.addEventListener('keydown', handleKey, true);
document.addEventListener('keypress', handleKey, true);
document.addEventListener('keyup', handleKey, true);

playerManager.addEventListener('newVideo', applyRate);
playerManager.addEventListener('playbackStart', applyRate);
