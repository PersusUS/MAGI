// MAGI Evangelion Speech-to-Text (STT) & Send Module - Persistent WebSpeech Engine
(function () {
    const LANG = navigator.language || 'es-ES';
    const IDLE_LABEL = '音 声';
    const MAX_SESSION_MS = 120000;
    const MAX_EMPTY_RESTARTS = 4;

    let recognition = null;
    let listening = false;        // the engine is actually running
    let wantListening = false;    // the user asked to be listening
    let carryOver = '';           // finals kept across silent auto-restarts
    let sessionText = '';         // text of the current recognition run
    let emptyRestarts = 0;
    let sessionDeadline = 0;
    let lastToggleTime = 0;
    let usingWhisper = false;     // fell back to the server-side engine
    let whisperPending = false;   // audio captured, transcription in flight
    let pendingSend = false;      // send as soon as the transcript settles
    let errored = false;          // keep the error visible instead of "completado"
    let mediaRecorder = null;
    let mediaStream = null;
    let stopTimeout = null;

    function logSTT(msg, type = 'info') {
        console.log('[MAGI STT]', msg);
        const logBox = document.getElementById('stt-debug-log');
        if (logBox) {
            const time = new Date().toLocaleTimeString();
            const prefix = type === 'error' ? '❌ ' : type === 'success' ? '✅ ' : 'ℹ️ ';
            logBox.innerText = `[${time}] ${prefix}${msg}`;
            if (type === 'error') {
                logBox.style.color = '#ff3b30';
                logBox.style.borderColor = '#ff3b30';
            } else if (type === 'success') {
                logBox.style.color = '#52e691';
                logBox.style.borderColor = '#52e691';
            } else {
                logBox.style.color = '#ff8d00';
                logBox.style.borderColor = '#ff8d00';
            }
        }
    }

    function setButton(label, active) {
        const btn = document.getElementById('stt-btn');
        if (!btn) return;
        btn.innerText = label;
        if (active) {
            btn.classList.add('stt-active');
        } else {
            btn.classList.remove('stt-active');
        }
    }

    function getQueryInput() {
        return document.getElementById('query');
    }

    function setNativeInputValue(input, value) {
        try {
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            nativeInputValueSetter.call(input, value);
        } catch (e) {
            input.value = value;
        }
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // dcc.Input(debounce=True) only publishes its value to Dash on React's
    // onKeyPress with Enter (native `keypress`, not `keydown`) or on blur.
    // Writing the value alone leaves the transcript stuck in the DOM.
    function commitToDash(input) {
        const opts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
        input.dispatchEvent(new KeyboardEvent('keydown', opts));
        input.dispatchEvent(new KeyboardEvent('keypress', opts));
        input.dispatchEvent(new KeyboardEvent('keyup', opts));
        // Blur commits too: harmless second publish of the same value, and it
        // covers renderers where the synthetic keypress does not reach React.
        input.blur();
    }

    function joinText(a, b) {
        if (!a) return b;
        if (!b) return a;
        return `${a} ${b}`;
    }

    function writeTranscript(text) {
        const input = getQueryInput();
        if (input) {
            setNativeInputValue(input, text);
        }
    }

    function currentTranscript() {
        return joinText(carryOver, sessionText).trim();
    }

    function resetSession() {
        carryOver = '';
        sessionText = '';
        emptyRestarts = 0;
        sessionDeadline = Date.now() + MAX_SESSION_MS;
        errored = false;
    }

    function stopListening(reason) {
        const wasListening = listening;
        wantListening = false;
        listening = false;

        if (stopTimeout) {
            clearTimeout(stopTimeout);
            stopTimeout = null;
        }

        if (usingWhisper) {
            stopWhisperCapture();
            return;
        }

        if (recognition && wasListening) {
            try { recognition.stop(); } catch (err) { /* already stopped */ }
        }

        if (!whisperPending) {
            setButton(IDLE_LABEL, false);
        }

        const transcript = currentTranscript();
        if (!errored) {
            logSTT(transcript ? `Dictado completado: "${transcript}"` : 'Dictado por voz completado.', transcript ? 'success' : 'info');
        } else if (reason) {
            logSTT(reason, 'info');
        }

        if (transcript) {
            writeTranscript(transcript);
        }
        if (window.MAGISound && !errored && transcript) {
            window.MAGISound.playBeep(1200, 0.08, 'sine', 0.12);
        }

        flushPendingSend();
    }

    // ---------------------------------------------------------------- WebSpeech

    function buildRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) return null;

        const rec = new SpeechRecognition();
        rec.continuous = true;      // do not cut the user off after a short pause
        rec.interimResults = true;
        rec.maxAlternatives = 1;
        rec.lang = LANG;

        rec.onstart = function () {
            if (!wantListening) {
                listening = false;
                try { rec.abort(); } catch (e) {}
                setButton(IDLE_LABEL, false);
                return;
            }
            listening = true;
            logSTT('Micrófono activado. Habla ahora...', 'success');
            setButton('録 音 中', true);
            if (window.MAGISound) {
                window.MAGISound.playBeep(1600, 0.08, 'sine', 0.15);
            }
        };

        rec.onspeechstart = function () {
            if (!wantListening) return;
            logSTT('Voz detectada. Escuchando...', 'info');
            setButton('検 知 中', true);
        };

        rec.onresult = function (event) {
            let parts = [];
            for (let i = 0; i < event.results.length; i++) {
                const item = event.results[i][0].transcript.trim();
                if (item) {
                    parts.push(item);
                }
            }
            sessionText = parts.join(' ');
            if (sessionText) {
                emptyRestarts = 0;
            }
            const fullText = currentTranscript();
            writeTranscript(fullText);
            logSTT(`Escuchando: "${fullText}"`, 'info');
        };

        rec.onerror = function (event) {
            // Chrome fires these on normal silence; onend decides what to do.
            if (event.error === 'no-speech' || event.error === 'aborted') {
                console.log('[MAGI STT] Evento silencioso / abortado:', event.error);
                return;
            }

            if (event.error === 'network' || event.error === 'service-not-allowed' || event.error === 'language-not-supported') {
                logSTT('Motor del navegador no disponible. Cambiando a Whisper...', 'info');
                listening = false;
                usingWhisper = true;
                if (wantListening) {
                    startWhisperCapture();
                }
                return;
            }

            let errMsg = `Estado del micrófono: ${event.error}`;
            if (event.error === 'not-allowed') {
                errMsg = 'Permiso de micrófono bloqueado en el navegador.';
            } else if (event.error === 'audio-capture') {
                errMsg = 'No se detecta ningún micrófono conectado.';
            }
            logSTT(errMsg, 'error');
            errored = true;
            wantListening = false;
            listening = false;
            pendingSend = false;
            setButton(IDLE_LABEL, false);
        };

        rec.onend = function () {
            listening = false;
            if (stopTimeout) {
                clearTimeout(stopTimeout);
                stopTimeout = null;
            }

            if (usingWhisper) {
                return;
            }

            // Chrome ends the run on its own after silence. Resume while the
            // user still wants to dictate, keeping what was already said.
            if (wantListening) {
                carryOver = joinText(carryOver, sessionText);
                sessionText = '';

                if (!currentTranscript()) {
                    emptyRestarts += 1;
                }

                if (emptyRestarts > MAX_EMPTY_RESTARTS) {
                    stopListening('Sin voz detectada. Micrófono detenido.');
                    return;
                }
                if (Date.now() > sessionDeadline) {
                    stopListening('Límite de dictado alcanzado. Micrófono detenido.');
                    return;
                }

                setTimeout(function () {
                    if (!wantListening || listening) return;
                    try {
                        recognition.start();
                    } catch (err) {
                        console.warn('[MAGI STT] No se pudo reanudar:', err);
                    }
                }, 120);
                return;
            }

            if (!wantListening) {
                const transcript = currentTranscript();
                // On error the log already explains what happened; do not bury it.
                if (!errored) {
                    logSTT(transcript ? `Dictado completado: "${transcript}"` : 'Dictado por voz completado.', transcript ? 'success' : 'info');
                }
                if (transcript) {
                    writeTranscript(transcript);
                }
                setButton(IDLE_LABEL, false);
                flushPendingSend();
                return;
            }
            setButton(IDLE_LABEL, false);
        };

        return rec;
    }

    function startWebSpeech() {
        if (!recognition) {
            recognition = buildRecognition();
        }
        if (!recognition) {
            logSTT('Navegador sin Web Speech API. Usando Whisper...', 'info');
            usingWhisper = true;
            startWhisperCapture();
            return;
        }

        setButton('機 動 中', true);
        try {
            recognition.start();
        } catch (err) {
            // InvalidStateError: the previous run has not fully ended yet.
            console.warn('[MAGI STT] Reintentando arranque:', err);
            try { recognition.stop(); } catch (ignore) { /* noop */ }
            setTimeout(function () {
                if (!wantListening || listening) return;
                try {
                    recognition.start();
                } catch (retryErr) {
                    logSTT(`No se pudo iniciar el micrófono: ${retryErr.message}`, 'error');
                    wantListening = false;
                    setButton(IDLE_LABEL, false);
                }
            }, 200);
        }
    }

    // ------------------------------------------------------------------ Whisper

    function pickMimeType() {
        const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
        for (let i = 0; i < candidates.length; i++) {
            if (window.MediaRecorder && MediaRecorder.isTypeSupported(candidates[i])) {
                return candidates[i];
            }
        }
        return '';
    }

    function extensionFor(mimeType) {
        if (mimeType.indexOf('ogg') !== -1) return 'ogg';
        if (mimeType.indexOf('mp4') !== -1) return 'mp4';
        return 'webm';
    }

    function startWhisperCapture() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
            logSTT('Este navegador no soporta captura de audio.', 'error');
            wantListening = false;
            setButton(IDLE_LABEL, false);
            return;
        }

        setButton('機 動 中', true);
        navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
            if (!wantListening) {
                stream.getTracks().forEach(function (t) { t.stop(); });
                return;
            }

            mediaStream = stream;
            const mimeType = pickMimeType();
            const chunks = [];
            mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

            mediaRecorder.ondataavailable = function (e) {
                if (e.data && e.data.size > 0) chunks.push(e.data);
            };

            mediaRecorder.onstop = function () {
                releaseStream();
                const type = mediaRecorder.mimeType || mimeType || 'audio/webm';
                const blob = new Blob(chunks, { type });
                if (blob.size < 1000) {
                    whisperPending = false;
                    pendingSend = false;
                    logSTT('Audio demasiado corto. Inténtalo de nuevo.', 'error');
                    setButton(IDLE_LABEL, false);
                    return;
                }
                sendToWhisper(blob, type);
            };

            mediaRecorder.start();
            listening = true;
            logSTT('Micrófono activado (Whisper). Pulsa de nuevo al terminar.', 'success');
            setButton('録 音 中', true);
            if (window.MAGISound) {
                window.MAGISound.playBeep(1600, 0.08, 'sine', 0.15);
            }
        }).catch(function (err) {
            const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
            logSTT(denied ? 'Permiso de micrófono bloqueado en el navegador.' : `No se pudo abrir el micrófono: ${err.message}`, 'error');
            wantListening = false;
            listening = false;
            pendingSend = false;
            setButton(IDLE_LABEL, false);
        });
    }

    function releaseStream() {
        if (mediaStream) {
            mediaStream.getTracks().forEach(function (t) { t.stop(); });
            mediaStream = null;
        }
    }

    function stopWhisperCapture() {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            whisperPending = true;
            setButton('解 析 中', true);
            try {
                mediaRecorder.stop();
            } catch (err) {
                whisperPending = false;
                releaseStream();
            }
        } else {
            releaseStream();
        }
        listening = false;
    }

    function sendToWhisper(blob, mimeType) {
        logSTT('Enviando audio a Whisper...', 'info');
        const form = new FormData();
        form.append('audio', blob, `speech.${extensionFor(mimeType)}`);

        const headers = {};
        const keyInput = document.getElementById('key');
        const keyVal = keyInput ? keyInput.value.trim() : '';
        // Skip placeholder/template keys and OpenRouter keys (no Whisper access)
        if (keyVal && !/^sk-or-/i.test(keyVal) &&
            !/your_|_here|changeme|placeholder|example/i.test(keyVal)) {
            headers['X-API-Key'] = keyVal;
        }

        fetch('/api/transcribe', { method: 'POST', body: form, headers })
            .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data }; }); })
            .then(function (result) {
                whisperPending = false;
                setButton(IDLE_LABEL, false);

                if (!result.ok || result.data.error) {
                    pendingSend = false;
                    errored = true;
                    logSTT(result.data.error || 'Whisper no pudo transcribir el audio.', 'error');
                    return;
                }
                const text = (result.data.text || '').trim();
                if (!text) {
                    pendingSend = false;
                    errored = true;
                    logSTT('Whisper no devolvió texto.', 'error');
                    return;
                }
                writeTranscript(text);
                logSTT(`Transcrito: "${text}"`, 'success');
                if (window.MAGISound) {
                    window.MAGISound.playBeep(1200, 0.08, 'sine', 0.12);
                }
                flushPendingSend();
            })
            .catch(function (err) {
                whisperPending = false;
                pendingSend = false;
                errored = true;
                logSTT(`Error de red al transcribir: ${err.message}`, 'error');
                setButton(IDLE_LABEL, false);
            });
    }

    // ------------------------------------------------------------------ Actions

    function toggleSTT(e) {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }

        const now = Date.now();
        if (now - lastToggleTime < 200) {
            return;
        }
        lastToggleTime = now;

        if (window.MAGISound) {
            window.MAGISound.resumeAudio();
        }

        if (wantListening) {
            stopListening('Deteniendo micrófono...');
            return;
        }

        wantListening = true;
        pendingSend = false;
        resetSession();
        writeTranscript('');
        logSTT('Iniciando captura de voz...');

        if (usingWhisper) {
            startWhisperCapture();
        } else {
            startWebSpeech();
        }
    }

    function doSend() {
        const queryInput = getQueryInput();
        if (!queryInput || queryInput.value.trim() === '') {
            logSTT('Escribe o dicta una pregunta antes de enviar', 'error');
            return;
        }

        const question = queryInput.value.trim();
        logSTT(`Enviando a MAGI: "${question}"`, 'success');

        if (window.MAGISound) {
            window.MAGISound.resumeAudio();
            window.MAGISound.playBeep(1400, 0.06, 'sine', 0.15);
        }

        setNativeInputValue(queryInput, question);
        commitToDash(queryInput);
    }

    function flushPendingSend() {
        if (!pendingSend) return;
        pendingSend = false;
        doSend();
    }

    function sendQuestion(e) {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }

        // Pressing 発送 mid-dictation: close the mic first and send whatever
        // the engine settles on, instead of sending a half-written transcript.
        if (wantListening || whisperPending) {
            pendingSend = true;
            stopListening('Cerrando micrófono antes de enviar...');
            return;
        }

        doSend();
    }

    document.addEventListener('click', function (e) {
        const sttBtn = e.target && (e.target.id === 'stt-btn' || e.target.closest('#stt-btn'));
        if (sttBtn) {
            toggleSTT(e);
            return;
        }

        const sendBtn = e.target && (e.target.id === 'send-btn' || e.target.closest('#send-btn'));
        if (sendBtn) {
            sendQuestion(e);
            return;
        }

        const debugBtn = e.target && (e.target.id === 'debug-btn' || e.target.closest('#debug-btn'));
        if (debugBtn) {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }
            const logBox = document.getElementById('stt-debug-log');
            if (logBox) {
                logBox.classList.toggle('stt-log-hidden');
            }
            if (window.MAGISound) {
                window.MAGISound.resumeAudio();
                window.MAGISound.playBeep(1800, 0.04, 'sine', 0.1);
            }
            return;
        }
    }, true);

})();
