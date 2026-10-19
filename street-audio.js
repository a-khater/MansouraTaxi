/** Original synthesized ambience; Arabic callouts use an available system voice.
 * No real people's recordings, music, or third-party voice imitation is used.
 */
export function createStreetAmbience(context, master, {lines = [], caption = () => {}} = {}) {
  let enabled = false, voiceClock = 7, hornClock = 2.5, captionClock = 0, seed = 90531, lineIndex = 0, ownSpeech = null;
  function stopSpeech() { if (ownSpeech) { globalThis.speechSynthesis?.cancel(); ownSpeech = null; } }
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate), samples = buffer.getChannelData(0);
  let previous = 0;
  for (let i = 0; i < samples.length; i++) { previous = (previous + (random() * 2 - 1) * .025) / 1.025; samples[i] = previous * 2.5; }
  const noise = context.createBufferSource(), filter = context.createBiquadFilter(), gain = context.createGain();
  noise.buffer = buffer; noise.loop = true; filter.type = 'lowpass'; filter.frequency.value = 900; gain.gain.value = 0;
  noise.connect(filter).connect(gain).connect(master); noise.start();
  const stats = {spokenCallouts: 0, syntheticHorns: 0, arabicVoiceAvailable: false};
  function horn(level) {
    const t = context.currentTime;
    for (const frequency of [310 + random() * 50, 405 + random() * 45]) {
      const oscillator = context.createOscillator(), envelope = context.createGain(), panner = context.createStereoPanner();
      oscillator.type = 'sawtooth'; oscillator.frequency.value = frequency; panner.pan.value = random() * 1.6 - .8;
      envelope.gain.setValueAtTime(.0001, t); envelope.gain.exponentialRampToValueAtTime(.025 * level, t + .035);
      envelope.gain.exponentialRampToValueAtTime(.0001, t + .20 + random() * .18);
      oscillator.connect(envelope).connect(panner).connect(master); oscillator.start(); oscillator.stop(t + .45);
    }
    stats.syntheticHorns++;
  }
  return {
    stats,
    setEnabled(value) { enabled = !!value; if (!enabled) { gain.gain.setTargetAtTime(0, context.currentTime, .05); stopSpeech(); caption(''); } },
    update(dt, {active = false, crowd = 0, traffic = 0} = {}) {
      const audible = enabled && active;
      gain.gain.setTargetAtTime(audible ? Math.min(.18, .025 + crowd / 1400 + traffic / 2400) : 0, context.currentTime, .3);
      if (!audible) { stopSpeech(); if (captionClock > 0) { caption(''); captionClock = 0; } return; }
      if (captionClock > 0) { captionClock -= dt; if (captionClock <= 0) caption(''); }
      hornClock -= dt; voiceClock -= dt;
      if (hornClock <= 0 && traffic > 8) { horn(.5 + random() * .5); hornClock = 3 + random() * 7; }
      if (voiceClock <= 0 && lines.length && (crowd > 4 || traffic > 12)) {
        const line = lines[(lineIndex++) % lines.length]; caption(line); captionClock = 4.5; voiceClock = 13 + random() * 10;
        const voices = globalThis.speechSynthesis?.getVoices() || [];
        const voice = voices.find(v => /^ar[-_]EG/i.test(v.lang)) || voices.find(v => /^ar\b/i.test(v.lang));
        stats.arabicVoiceAvailable = !!voice;
        if (voice && !speechSynthesis.speaking) {
          const utterance = new SpeechSynthesisUtterance(line); utterance.voice = voice; utterance.lang = 'ar-EG';
          utterance.rate = 1.06; utterance.pitch = .9 + random() * .2; utterance.volume = .45;
          ownSpeech = utterance; utterance.onend = utterance.onerror = () => { if (ownSpeech === utterance) ownSpeech = null; };
          speechSynthesis.speak(utterance); stats.spokenCallouts++;
        }
      }
    },
    dispose() { stopSpeech(); noise.stop(); noise.disconnect(); filter.disconnect(); gain.disconnect(); }
  };
}
