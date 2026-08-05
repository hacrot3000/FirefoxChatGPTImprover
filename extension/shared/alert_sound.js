(() => {
  "use strict";

  if (globalThis.FCI_ALERT_SOUND?.VERSION >= 1) {
    return;
  }

  const TONES = Object.freeze({
    "soft-chime": Object.freeze([
      Object.freeze({ frequency: 659.25, durationMs: 120, gain: 0.72 }),
      Object.freeze({ frequency: 880.0, durationMs: 180, gain: 0.9, delayMs: 45 })
    ]),
    "double-beep": Object.freeze([
      Object.freeze({ frequency: 740.0, durationMs: 105, gain: 0.86 }),
      Object.freeze({ frequency: 740.0, durationMs: 105, gain: 0.86, delayMs: 120 })
    ]),
    urgent: Object.freeze([
      Object.freeze({ frequency: 880.0, durationMs: 90, gain: 0.95 }),
      Object.freeze({ frequency: 1046.5, durationMs: 90, gain: 1.0, delayMs: 70 }),
      Object.freeze({ frequency: 880.0, durationMs: 120, gain: 0.95, delayMs: 70 })
    ])
  });

  function clampNumber(value, fallback, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
  }

  function clampInteger(value, fallback, min, max) {
    const number = Number(value);
    if (!Number.isInteger(number)) return fallback;
    return Math.min(max, Math.max(min, number));
  }

  function normalizeOptions(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    const tone = Object.hasOwn(TONES, source.tone) ? source.tone : "soft-chime";
    return {
      enabled: source.enabled === true,
      tone,
      volume: clampNumber(source.volume, 0.45, 0, 1),
      repeatCount: clampInteger(source.repeatCount, 1, 1, 5),
      repeatIntervalMs: clampInteger(source.repeatIntervalMs, 900, 250, 10000)
    };
  }

  function patternDurationMs(tone) {
    const pattern = TONES[tone] || TONES["soft-chime"];
    return pattern.reduce((total, item) => total + Number(item.delayMs || 0) + Number(item.durationMs || 0), 0);
  }

  function createPlayer({ audioContextFactory = null, scheduler = null } = {}) {
    const activeTimers = new Set();
    const schedule = scheduler || {
      setTimeout(callback, delay) { return globalThis.setTimeout(callback, delay); },
      clearTimeout(timer) { globalThis.clearTimeout(timer); }
    };
    let context = null;
    let generation = 0;

    function clearTimers() {
      for (const timer of activeTimers) {
        schedule.clearTimeout(timer);
      }
      activeTimers.clear();
    }

    function stop() {
      generation += 1;
      clearTimers();
    }

    function getContext() {
      if (context && context.state !== "closed") return context;
      if (typeof audioContextFactory === "function") {
        context = audioContextFactory();
        return context;
      }
      const AudioContextCtor = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (typeof AudioContextCtor !== "function") return null;
      context = new AudioContextCtor();
      return context;
    }

    function scheduleTone(ctx, startAt, item, volume, currentGeneration) {
      const delaySeconds = Number(item.delayMs || 0) / 1000;
      const durationSeconds = Math.max(0.02, Number(item.durationMs || 0) / 1000);
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(Number(item.frequency || 660), startAt + delaySeconds);
      const peak = Math.max(0.0001, Math.min(1, volume * Number(item.gain || 1)));
      gain.gain.setValueAtTime(0.0001, startAt + delaySeconds);
      gain.gain.exponentialRampToValueAtTime(peak, startAt + delaySeconds + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + delaySeconds + durationSeconds);
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start(startAt + delaySeconds);
      oscillator.stop(startAt + delaySeconds + durationSeconds + 0.02);
      oscillator.addEventListener?.("ended", () => {
        if (currentGeneration === generation) {
          try { oscillator.disconnect(); } catch (_error) {}
          try { gain.disconnect(); } catch (_error) {}
        }
      }, { once: true });
      return delaySeconds + durationSeconds;
    }

    async function play(rawOptions = {}, { force = false } = {}) {
      const options = normalizeOptions(rawOptions);
      if (!options.enabled && !force) {
        return { started: false, reason: "disabled", options };
      }
      stop();
      const currentGeneration = generation;
      const ctx = getContext();
      if (!ctx) {
        return { started: false, reason: "audio-context-unavailable", options };
      }
      try {
        if (ctx.state === "suspended" && typeof ctx.resume === "function") {
          await ctx.resume();
        }
      } catch (error) {
        return { started: false, reason: error instanceof Error ? error.message : String(error), options };
      }
      if (ctx.state === "suspended") {
        return { started: false, reason: "audio-context-suspended", options };
      }

      const pattern = TONES[options.tone] || TONES["soft-chime"];
      const onePatternMs = patternDurationMs(options.tone);
      for (let repeatIndex = 0; repeatIndex < options.repeatCount; repeatIndex += 1) {
        const timer = schedule.setTimeout(() => {
          activeTimers.delete(timer);
          if (currentGeneration !== generation) return;
          let cursor = ctx.currentTime + 0.025;
          for (const item of pattern) {
            cursor += scheduleTone(ctx, cursor, item, options.volume, currentGeneration);
          }
        }, repeatIndex * Math.max(options.repeatIntervalMs, onePatternMs + 80));
        activeTimers.add(timer);
      }
      return { started: true, reason: null, options };
    }

    return Object.freeze({ play, stop });
  }

  Object.defineProperty(globalThis, "FCI_ALERT_SOUND", {
    configurable: true,
    enumerable: false,
    writable: false,
    value: Object.freeze({
      VERSION: 1,
      TONES,
      normalizeOptions,
      patternDurationMs,
      createPlayer
    })
  });
})();
