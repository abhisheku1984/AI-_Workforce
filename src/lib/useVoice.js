/**
 * useVoice — speech in, speech out, with the failure modes handled honestly.
 *
 * Browser support is uneven and the APIs behave differently in each engine, so this hook
 * reports its own capability rather than leaving the UI to guess:
 *
 *   { supported: false, reason: 'browser' }                 no SpeechRecognition at all
 *   { supported: false, reason: 'insecure' }                mic needs HTTPS or localhost
 *   { supported: true }                                     usable
 *
 * Design decisions worth stating:
 *  - Nothing is spoken automatically unless the user turned "Speak answers" on. An assistant
 *    that starts talking is worse than one that stays quiet.
 *  - Speech recognition is one-shot per press: press, speak, it stops on silence. Continuous
 *    listening with no visible state is how microphones get left open by accident.
 *  - The mic is never accessed before the user presses the button, so no permission prompt
 *    appears on page load.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { pickVoice, speechLocale, speechSummary, toSpeechText } from './voice.js';

const SpeechRecognition =
  typeof window !== 'undefined'
    ? window.SpeechRecognition || window.webkitSpeechRecognition || null
    : null;

/** Why voice input is unavailable, in terms a user can act on. */
export function voiceAvailability() {
  if (typeof window === 'undefined') return { input: false, output: false, reason: 'server' };
  const secure = window.isSecureContext;
  const output = typeof window.speechSynthesis !== 'undefined' && typeof window.SpeechSynthesisUtterance !== 'undefined';
  if (!SpeechRecognition) {
    return {
      input: false,
      output,
      reason: secure ? 'browser' : 'insecure',
    };
  }
  if (!secure) return { input: false, output, reason: 'insecure' };
  return { input: true, output, reason: null };
}

export function useVoice({ onTranscript, onError } = {}) {
  const availability = voiceAvailability();
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [speakAnswers, setSpeakAnswers] = useState(() => {
    try { return localStorage.getItem('wiq.voice.speak') === '1'; } catch { return false; }
  });
  const [interim, setInterim] = useState('');
  const [error, setError] = useState(null);
  const [voices, setVoices] = useState([]);
  const [voiceName, setVoiceName] = useState(() => {
    try { return localStorage.getItem('wiq.voice.name') || ''; } catch { return ''; }
  });

  const recognitionRef = useRef(null);
  const transcriptRef = useRef(onTranscript);
  const errorRef = useRef(onError);
  transcriptRef.current = onTranscript;
  errorRef.current = onError;

  useEffect(() => {
    try { localStorage.setItem('wiq.voice.speak', speakAnswers ? '1' : '0'); } catch { /* private mode */ }
  }, [speakAnswers]);

  /* ---------------------------------------------------------------- speech in */

  const stopListening = useCallback(() => {
    try { recognitionRef.current?.stop(); } catch { /* already stopped */ }
    setListening(false);
    setInterim('');
  }, []);

  const startListening = useCallback(() => {
    if (!availability.input) {
      const message = availability.reason === 'insecure'
        ? 'The microphone needs a secure page. Use https or localhost.'
        : 'This browser does not support speech recognition. Chrome and Edge do.';
      setError(message);
      errorRef.current?.(message);
      return;
    }
    if (recognitionRef.current) return; // already running

    const recognition = new SpeechRecognition();
    // Recognition listens in the same English variant we speak in, so an Indian-English
    // speaker is not transcribed by a US-English acoustic model.
    recognition.lang = preferredVoice?.lang || speechLocale(typeof navigator !== 'undefined' ? navigator.language : 'en-IN');
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;

    let finalText = '';

    recognition.onstart = () => { setError(null); setListening(true); };
    recognition.onresult = (event) => {
      let partial = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result.isFinal) finalText += result[0].transcript;
        else partial += result[0].transcript;
      }
      setInterim(partial);
    };
    recognition.onerror = (event) => {
      // 'aborted' and 'no-speech' are ordinary outcomes of a one-shot listen, not failures.
      if (event.error === 'aborted' || event.error === 'no-speech') {
        setListening(false);
        return;
      }
      const message = event.error === 'not-allowed' || event.error === 'service-not-allowed'
        ? 'Microphone permission was refused. Allow it in the browser site settings and try again.'
        : event.error === 'network'
          ? 'Speech recognition needs a network connection in this browser.'
          : `Speech recognition stopped: ${event.error}.`;
      setError(message);
      errorRef.current?.(message);
    };
    recognition.onend = () => {
      setListening(false);
      setInterim('');
      recognitionRef.current = null;
      const said = finalText.trim();
      if (said) transcriptRef.current?.(said);
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch (err) {
      recognitionRef.current = null;
      setListening(false);
      setError(err.message || 'Could not start the microphone.');
    }
  }, [availability.input, availability.reason, preferredVoice, SpeechRecognition]);

  const toggleListening = useCallback(() => {
    if (listening) stopListening();
    else startListening();
  }, [listening, startListening, stopListening]);

  /* ---------------------------------------------------------------- voice selection */

  // SpeechSynthesis populates asynchronously and fires voiceschanged when ready. Choosing a
  // voice once and caching it is the documented workaround for Chrome returning [] on first call.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return undefined;
    const load = () => {
      const found = window.speechSynthesis.getVoices() || [];
      if (found.length) setVoices(found);
    };
    load();
    window.speechSynthesis.addEventListener?.('voiceschanged', load);
    return () => window.speechSynthesis.removeEventListener?.('voiceschanged', load);
  }, []);

  const preferredVoice = useMemo(
    () => pickVoice(voices, voiceName),
    [voices, voiceName],
  );

  useEffect(() => {
    try { localStorage.setItem('wiq.voice.name', voiceName || ''); } catch { /* private mode */ }
  }, [voiceName]);

  /* ---------------------------------------------------------------- speech out */

  const stopSpeaking = useCallback(() => {
    try { window.speechSynthesis?.cancel(); } catch { /* nothing to cancel */ }
    setSpeaking(false);
  }, []);

  const speak = useCallback((text, { summary = true, answer = null } = {}) => {
    if (!availability.output) return false;
    const source = answer && summary ? speechSummary(answer) : toSpeechText(text);
    if (!source) return false;
    try {
      window.speechSynthesis.cancel(); // one utterance at a time
      const utterance = new window.SpeechSynthesisUtterance(source);
      if (preferredVoice) {
        utterance.voice = preferredVoice;
        utterance.lang = preferredVoice.lang;
      } else {
        utterance.lang = speechLocale(typeof navigator !== 'undefined' ? navigator.language : 'en-IN');
      }
      utterance.rate = 1;
      utterance.pitch = 1;
      utterance.onstart = () => setSpeaking(true);
      utterance.onend = () => setSpeaking(false);
      utterance.onerror = () => setSpeaking(false);
      window.speechSynthesis.speak(utterance);
      return true;
    } catch (err) {
      setError(err.message || 'Could not speak the answer.');
      return false;
    }
  }, [availability.output, preferredVoice]);

  // Cancel any speech when the page is left, so audio never follows the user around.
  useEffect(() => () => {
    try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
    try { recognitionRef.current?.abort(); } catch { /* ignore */ }
  }, []);

  return {
    availability,
    listening,
    speaking,
    speakAnswers,
    setSpeakAnswers,
    interim,
    error,
    voices,
    voiceName,
    setVoiceName,
    preferredVoice,
    clearError: () => setError(null),
    startListening,
    stopListening,
    toggleListening,
    speak,
    stopSpeaking,
  };
}
