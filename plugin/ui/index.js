function sttTargetLabel(target) {
    if (!target) return '';
    return target.charAt(0).toUpperCase() + target.slice(1);
}

function sttComponent() {
    return {
        mediaRecorder: null,
        audioChunks: [],
        audioStream: null,
        audioContext: null,
        analyser: null,
        recordingTime: '00:00',
        recordingTimer: null,
        recordingHoldTimer: null,
        wakeLock: null,
        recordingStartTime: null,
        recordingMode: null,
        recordingPressStart: null,
        recordingTapHandled: false,
        _target: null,
        _transcribeHandlers: {},
        _stopping: null,
        _rafId: null,
        _analyserSource: null,
        _lastTranscript: null,

        init() {
            document.querySelectorAll('body > .voice-bar').forEach((el) => el.remove());
            const bar = this.$el.querySelector('.voice-bar');
            if (bar) document.body.appendChild(bar);
            if (!document.getElementById('stt-voice-bar-css')) {
                const link = document.createElement('link');
                link.rel = 'stylesheet';
                link.id = 'stt-voice-bar-css';
                link.href = '/plugins/stt/ui/style.css?v=' + (window.AM_CACHE_V || '');
                document.head.appendChild(link);
            }
            Alpine.store('voice', {
                target: null,
                time: '00:00',
                isRecording: false,
                isTranscribing: false,
                level: 0,
                levels: [0, 0, 0, 0, 0],
            });
            AM.voice = {
                startRecording: (target, mode) => this.startRecording(target, mode),
                stopRecording: () => this.stopRecording(),
                cancelRecording: () => this.cancelRecording(),
                isRecording: () => Alpine.store('voice')?.isRecording || false,
                getTarget: () => Alpine.store('voice')?.target || null,
                onTranscribe: (target, fn) => { this._transcribeHandlers[target] = fn; },
                handleMicDown: (target, event) => this.handleMicDown(target, event),
                handleMicUp: (target) => this.handleMicUp(target),
                handleMicClick: (target) => this.handleMicClick(target),
                handleMicCancel: (target) => this.handleMicCancel(target),
            };
            AM.stt = {
                getLastTranscript: () => this._lastTranscript || null,
            };
            AM.onCleanup(() => { if (Alpine.store('voice')?.isRecording) this.stopRecording(); });
        },

        async startRecording(target, mode = 'toggle') {
            const store = Alpine.store('voice');
            if (this._stopping) await this._stopping;
            if (store.isRecording && this._target !== target) {
                await this.stopRecording();
            }
            if (store.isRecording && this._target === target && mode === 'toggle') {
                await this.stopRecording();
                return;
            }
            this._target = target;
            this.recordingMode = mode;
            this.recordingStartTime = Date.now();
            this.recordingTime = '00:00';
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                this.audioStream = stream;
                this.audioChunks = [];
                const mt = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
                this.mediaRecorder = new MediaRecorder(stream, { mimeType: mt });
                this.mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) this.audioChunks.push(e.data); };
                this.mediaRecorder.onstop = () => {
                    if (this.audioStream) { this.audioStream.getTracks().forEach(t => t.stop()); this.audioStream = null; }
                };
                this.mediaRecorder.start(1000);
                this._setupAnalyser(stream);
                if (store) { store.target = target; store.isRecording = true; store.isTranscribing = false; store.level = 0; store.levels = [0, 0, 0, 0, 0]; }

                this.recordingTimer = setInterval(() => {
                    const elapsed = Math.floor((Date.now() - this.recordingStartTime) / 1000);
                    this.recordingTime = String(Math.floor(elapsed / 60)).padStart(2, '0') + ':' + String(elapsed % 60).padStart(2, '0');
                    if (store) store.time = this.recordingTime;
                }, 1000);

                try {
                    if ('wakeLock' in navigator) {
                        this.wakeLock = await navigator.wakeLock.request('screen');
                    }
                } catch (e) { console.error('STT wakeLock request', e); }
            } catch (e) {
                if (this.audioStream) { this.audioStream.getTracks().forEach(t => t.stop()); this.audioStream = null; }
                this._target = null;
                this.recordingMode = null;
                this.recordingStartTime = null;
                if (store) { store.target = null; store.isRecording = false; store.isTranscribing = false; }
                AM.toast('Microphone access denied', 'error');
            }
        },

        async stopRecording(cancelled = false) {
            const store = Alpine.store('voice');
            if (!store?.isRecording) return;
            clearInterval(this.recordingTimer);
            this.recordingTimer = null;
            this.recordingTime = '00:00';
            this._teardownAnalyser();
            const elapsedSeconds = this.recordingStartTime ? (Date.now() - this.recordingStartTime) / 1000 : 0;
            const target = this._target;
            store.isRecording = false;
            store.time = '00:00';
            store.level = 0;
            store.levels = [0, 0, 0, 0, 0];
            if (!cancelled) store.isTranscribing = true;
            const finish = () => {
                const chunks = this.audioChunks;
                this.audioChunks = [];
                this._stopping = null;
                if (!cancelled) this.processRecording(target, chunks, elapsedSeconds);
            };
            if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
                this._stopping = new Promise((resolve) => {
                    this.mediaRecorder.onstop = () => {
                        if (this.audioStream) { this.audioStream.getTracks().forEach(t => t.stop()); this.audioStream = null; }
                        resolve();
                        finish();
                    };
                    this.mediaRecorder.stop();
                });
                await this._stopping;
            } else {
                if (this.audioStream) { this.audioStream.getTracks().forEach(t => t.stop()); this.audioStream = null; }
                finish();
            }
            if (cancelled) {
                this.audioChunks = [];
                store.isTranscribing = false;
                store.target = null;
            }
            if (this.wakeLock) {
                try { await this.wakeLock.release(); } catch (e) { console.error('STT wakeLock release', e); }
                this.wakeLock = null;
            }
            this._target = null;
            this.recordingMode = null;
            this.recordingStartTime = null;
        },

        cancelRecording() {
            return this.stopRecording(true);
        },

        handleMicDown(target, event) {
            if (event && event.pointerId !== undefined) {
                try { event.currentTarget.setPointerCapture(event.pointerId); } catch (e) { console.error('STT setPointerCapture', e); }
            }
            if (this.recordingHoldTimer) { clearTimeout(this.recordingHoldTimer); this.recordingHoldTimer = null; }
            this.recordingPressStart = Date.now();
            this.recordingTapHandled = false;
            if (Alpine.store('voice')?.isRecording && this._target === target) return;
            this.recordingHoldTimer = setTimeout(() => {
                this.recordingHoldTimer = null;
                this.recordingPressStart = null;
                this.recordingTapHandled = false;
                this.startRecording(target, 'hold');
            }, 250);
        },

        handleMicUp(target) {
            if (this.recordingHoldTimer) {
                clearTimeout(this.recordingHoldTimer);
                this.recordingHoldTimer = null;
                this.recordingPressStart = null;
                this.recordingTapHandled = true;
                this.startRecording(target, 'toggle');
                return;
            }
            if (this.recordingMode === 'hold' && this._target === target) {
                this.recordingTapHandled = true;
                this.stopRecording();
                return;
            }
            if (this.recordingMode === 'toggle' && this._target === target) {
                this.recordingTapHandled = true;
                this.stopRecording();
            }
        },

        handleMicClick(target) {
            if (this.recordingTapHandled) {
                this.recordingTapHandled = false;
                this.recordingPressStart = null;
                return;
            }
            const hadPressStart = this.recordingPressStart !== null;
            const duration = this.recordingPressStart ? Date.now() - this.recordingPressStart : 0;
            this.recordingPressStart = null;
            if (this.recordingHoldTimer) {
                clearTimeout(this.recordingHoldTimer);
                this.recordingHoldTimer = null;
            }
            if (Alpine.store('voice')?.isRecording && this._target === target && this.recordingMode === 'toggle') {
                this.startRecording(target, 'toggle');
                return;
            }
            if (!hadPressStart || duration < 250) {
                this.startRecording(target, 'toggle');
            }
        },

        handleMicCancel(target) {
            if (this.recordingHoldTimer) {
                clearTimeout(this.recordingHoldTimer);
                this.recordingHoldTimer = null;
            }
            this.recordingPressStart = null;
            if (this.recordingMode === 'hold') {
                this.stopRecording();
            }
        },

        _setupAnalyser(stream) {
            try {
                const AudioCtx = window.AudioContext || window.webkitAudioContext;
                if (!AudioCtx) return;
                this.audioContext = new AudioCtx();
                this._analyserSource = this.audioContext.createMediaStreamSource(stream);
                this.analyser = this.audioContext.createAnalyser();
                this.analyser.fftSize = 512;
                this._analyserSource.connect(this.analyser);
                const buf = new Float32Array(this.analyser.fftSize);
                const tick = () => {
                    if (!this.analyser) return;
                    this.analyser.getFloatTimeDomainData(buf);
                    let sum = 0;
                    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
                    const rms = Math.sqrt(sum / buf.length);
                    const store = Alpine.store('voice');
                    if (store && store.isRecording) {
                        store.level = rms;
                        store.levels = store.levels.slice(1).concat(rms);
                    }
                    this._rafId = requestAnimationFrame(tick);
                };
                tick();
            } catch (e) {
                console.error('STT analyser setup', e);
            }
        },

        _teardownAnalyser() {
            if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
            if (this._analyserSource) {
                try { this._analyserSource.disconnect(); } catch (e) { console.error('STT analyser disconnect', e); }
                this._analyserSource = null;
            }
            this.analyser = null;
            if (this.audioContext) {
                const ctx = this.audioContext;
                this.audioContext = null;
                try { ctx.close().catch(() => {}); } catch (e) { console.error('STT audio context close', e); }
            }
        },

        _formatDuration(seconds) {
            const total = Math.max(0, Math.round(seconds));
            return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0');
        },

        async processRecording(target, chunks, elapsedSeconds) {
            const blob = new Blob(chunks, { type: 'audio/webm' });
            try {
                const formData = new FormData();
                formData.append('file', blob, 'recording.webm');
                const resp = await AM.fetch('/plugins/stt/transcribe', { method: 'POST', body: formData });
                if (!resp.ok) throw new Error('Transcription failed');
                const data = await resp.json();
                this._lastTranscript = data;
                if (typeof data.duration === 'number' && elapsedSeconds > 0 && data.duration < 0.7 * elapsedSeconds) {
                    AM.toast('Transcription may be incomplete (recorded ' + this._formatDuration(elapsedSeconds) + ', got ' + this._formatDuration(data.duration) + ')', 'warning');
                }
                const text = data.text || '';
                if (!text) { AM.toast('No speech detected', 'warning'); return; }
                if (data.name_corrections && data.name_corrections.length > 0) {
                    const names = data.name_corrections.map(([from, to]) => from + ' \u2192 ' + to).join(', ');
                    AM.toast('Names corrected: ' + names, 'success');
                }
                const handler = this._transcribeHandlers[target];
                if (handler) handler(text, blob);
            } catch (e) { AM.toast('Transcription failed', 'error'); }
            finally {
                const store = Alpine.store('voice');
                if (store && !store.isRecording) {
                    store.isTranscribing = false;
                    store.target = null;
                }
            }
        },
    };
}
