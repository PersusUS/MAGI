// MAGI Evangelion Computer Web Audio API Sound System
(function () {
    let audioCtx = null;
    let processingInterval = null;

    function getAudioContext() {
        if (!audioCtx) {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (AudioContextClass) {
                audioCtx = new AudioContextClass();
            }
        }
        if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        return audioCtx;
    }

    function playBeep(freq = 1200, duration = 0.05, type = 'sine', volume = 0.12) {
        try {
            const ctx = getAudioContext();
            if (!ctx) return;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = type;
            osc.frequency.setValueAtTime(freq, ctx.currentTime);
            
            gain.gain.setValueAtTime(volume, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);

            osc.connect(gain);
            gain.connect(ctx.destination);

            osc.start();
            osc.stop(ctx.currentTime + duration);
        } catch (e) {
            console.error('MAGI Audio error:', e);
        }
    }

    // Vintage 90s Japanese Anime TV Synthesizer (Mi6 bemol / Eb6 = 1244.51 Hz)
    function playVintageJapaneseAnimePiii(freq = 1244.51, duration = 1.2, volume = 0.22) {
        try {
            const ctx = getAudioContext();
            if (!ctx) return;
            const now = ctx.currentTime;

            // Vintage 90s Japanese anime computer synth: triangle + sine hybrid for warm CRT TV speaker timbre
            const oscMain = ctx.createOscillator();
            const oscSub = ctx.createOscillator();
            const gain = ctx.createGain();

            oscMain.type = 'triangle'; // Warm vintage 90s anime synth timbre
            oscMain.frequency.setValueAtTime(freq, now);

            oscSub.type = 'sine'; // Pure fundamental body
            oscSub.frequency.setValueAtTime(freq, now);

            // Vintage analog speaker envelope: instant attack, steady 1s sustain, warm exponential fade
            gain.gain.setValueAtTime(volume, now);
            gain.gain.setValueAtTime(volume, now + duration - 0.2);
            gain.gain.exponentialRampToValueAtTime(0.00001, now + duration);

            oscMain.connect(gain);
            oscSub.connect(gain);
            gain.connect(ctx.destination);

            oscMain.start(now);
            oscSub.start(now);
            oscMain.stop(now + duration);
            oscSub.stop(now + duration);
        } catch (e) {
            console.error('MAGI Vintage Piii audio error:', e);
        }
    }

    function startProcessingSound() {
        if (processingInterval) return;
        // Moderate pitch computation beeps as originally set
        const freqs = [1400, 1650, 1850, 1500, 1950, 1300];
        let idx = 0;
        processingInterval = setInterval(() => {
            playBeep(freqs[idx % freqs.length], 0.045, 'square', 0.08);
            idx++;
        }, 160);
    }

    function stopProcessingSound() {
        if (processingInterval) {
            clearInterval(processingInterval);
            processingInterval = null;
        }
    }

    // Authentic Evangelion MAGI Resolution Sound Effects
    function playResolutionSound(status) {
        stopProcessingSound();
        try {
            const ctx = getAudioContext();
            if (!ctx) return;

            // 1. Play the iconic 90s Japanese anime TV sustained tone in Mi6 bemol (Eb6 = 1244.51 Hz) for 1.0s
            playVintageJapaneseAnimePiii(1244.51, 1.0, 0.22);

            // 2. Play resolution status accent after short delay
            setTimeout(() => {
                if (status === 'yes') {
                    // Agreement (合意) - Classic Japanese anime double chime accent (Eb6 -> Ab6)
                    playBeep(1244.51, 0.1, 'triangle', 0.18);
                    setTimeout(() => playBeep(1661.22, 0.25, 'triangle', 0.22), 90);
                } else if (status === 'no') {
                    // Rejection (拒絶) - Low Evangelion NERV warning tone
                    playBeep(440, 0.15, 'sawtooth', 0.2);
                    setTimeout(() => playBeep(311.13, 0.35, 'sawtooth', 0.22), 110);
                } else if (status === 'conditional') {
                    // Conditional (状態) - Triple retro anime pulse
                    playBeep(1244.51, 0.08, 'triangle', 0.15);
                    setTimeout(() => playBeep(1479.98, 0.08, 'triangle', 0.15), 80);
                    setTimeout(() => playBeep(1244.51, 0.12, 'triangle', 0.15), 160);
                } else if (status === 'info') {
                    // Information (情報) - Dual retro chime
                    playBeep(1244.51, 0.1, 'triangle', 0.18);
                    setTimeout(() => playBeep(1661.22, 0.15, 'triangle', 0.2), 90);
                }
            }, 500);

        } catch (e) {
            console.error('MAGI Audio resolution error:', e);
        }
    }

    // Expose MAGISound globally
    window.MAGISound = {
        playBeep,
        playVintageJapaneseAnimePiii,
        startProcessingSound,
        stopProcessingSound,
        playResolutionSound,
        resumeAudio: getAudioContext
    };

    // Unlock Web Audio API context on any user interaction (required by Opera/Chrome autoplay policy)
    window.addEventListener('click', getAudioContext, { capture: true, passive: true });
    window.addEventListener('keydown', function(e) {
        getAudioContext();
        if (e.key === 'Enter') {
            playBeep(1400, 0.06, 'sine', 0.15);
        }
    }, { capture: true, passive: true });

})();
