function sttComponent() {
    return {
        mediaRecorder: null,
        audioChunks: [],
        audioStream: null,
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

        init() {
            Alpine.store('voice', {
                target: null,
                time: '00:00',
                isRecording: false,
            });
            AM.voice = {
                startRecording: (target, mode) => this.startRecording(target, mode),
                stopRecording: () => this.stopRecording(),
                isRecording: () => Alpine.store('voice')?.isRecording || false,
                getTarget: () => Alpine.store('voice')?.target || null,
                onTranscribe: (target, fn) => { this._transcribeHandlers[target] = fn; },
                handleMicDown: (target, event) => this.handleMicDown(target, event),
                handleMicUp: (target) => this.handleMicUp(target),
                handleMicClick: (target) => this.handleMicClick(target),
                handleMicCancel: (target) => this.handleMicCancel(target),
            };
            AM.onCleanup(() => { if (Alpine.store('voice')?.isRecording) this.stopRecording(); });
        },

        async startRecording(target, mode = 'toggle') {
            const store = Alpine.store('voice');
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
                this.mediaRecorder.start();
                if (store) { store.target = target; store.isRecording = true; }

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
                this._target = null;
                this.recordingMode = null;
                this.recordingStartTime = null;
                if (store) { store.target = null; store.isRecording = false; }
                AM.toast('Microphone access denied', 'error');
            }
        },

        async stopRecording() {
            const store = Alpine.store('voice');
            if (!store?.isRecording) return;
            clearInterval(this.recordingTimer);
            this.recordingTimer = null;
            this.recordingTime = '00:00';
            if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
                const target = this._target;
                this.mediaRecorder.onstop = () => {
                    if (this.audioStream) { this.audioStream.getTracks().forEach(t => t.stop()); this.audioStream = null; }
                    this.processRecording(target);
                };
                this.mediaRecorder.stop();
            } else {
                if (this.audioStream) { this.audioStream.getTracks().forEach(t => t.stop()); this.audioStream = null; }
            }
            if (this.wakeLock) {
                try { await this.wakeLock.release(); } catch (e) { console.error('STT wakeLock release', e); }
                this.wakeLock = null;
            }
            if (store) { store.target = null; store.isRecording = false; store.time = '00:00'; }
            this._target = null;
            this.recordingMode = null;
            this.recordingStartTime = null;
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

        async processRecording(target) {
            const blob = new Blob(this.audioChunks, { type: 'audio/webm' });
            try {
                const formData = new FormData();
                formData.append('file', blob, 'recording.webm');
                const resp = await AM.fetch('/plugins/stt/transcribe', { method: 'POST', body: formData });
                if (!resp.ok) throw new Error('Transcription failed');
                const data = await resp.json();
                const text = data.text || '';
                if (!text) { AM.toast('No speech detected', 'warning'); return; }
                if (data.name_corrections && data.name_corrections.length > 0) {
                    const names = data.name_corrections.map(([from, to]) => from + ' \u2192 ' + to).join(', ');
                    AM.toast('Names corrected: ' + names, 'success');
                }
                const handler = this._transcribeHandlers[target];
                if (handler) handler(text, blob);
            } catch (e) { AM.toast('Transcription failed', 'error'); }
        },
    };
}
