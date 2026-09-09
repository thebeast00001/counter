import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from 'expo-audio';
import { File } from 'expo-file-system';
import { useCallback, useState } from 'react';

import { AiError, transcribe } from '@/ai/provider';

/**
 * Asking out loud.
 *
 * Typing an English question is the part of this app that fits its owner worst.
 * The people it is for run a counter in Hindi, Marathi or Tamil and reach for a
 * keyboard last — and Sarvam detects the language from the audio itself, so
 * there is nothing to configure and no "which language" menu to get wrong.
 *
 * ## Why this imports statically when `reminders.ts` does not
 *
 * `expo-notifications` throws on import in Expo Go and has to be gated before it
 * is touched. `expo-audio` does not: it ships in the Go client and records
 * there. The lazy-require dance is a cost with no benefit here, and a first
 * attempt at it was worse than useless — it reached for
 * `AudioModule.AudioRecorder`, which typechecks through a namespace import and
 * is `undefined` at runtime, because `AudioModule` is a default import *inside*
 * the package rather than part of its public surface. The hook is the only
 * supported way to get a recorder, so the hook is what this uses.
 *
 * ## What leaves the device
 *
 * The audio does, unredacted, and this is the only place in the app where that
 * is true. `redact.ts` cannot swap a spoken name for a token without first
 * knowing it was spoken, which is the transcription itself. The exposure is one
 * hop: what comes back is put through the curtain like any typed question, and
 * the surface offering the microphone says so.
 */

export type VoiceState = 'idle' | 'listening' | 'thinking';

export type Voice = {
  state: VoiceState;
  /** The last thing that went wrong, for the surface to show. */
  problem: string | null;
  clearProblem: () => void;
  start: () => void;
  stop: () => void;
};

/**
 * Deletes a finished recording.
 *
 * `useAudioRecorder` writes to the cache directory and leaves the file there
 * for the OS to reclaim whenever it feels like it. For most apps that is
 * housekeeping; here the file is a shopkeeper saying a customer's name and an
 * amount out loud, sitting in cleartext on the filesystem for an unbounded
 * length of time. The Play declaration says a recording is not retained, and
 * this is the line that makes that true rather than aspirational.
 *
 * Deleted in a `finally`, so a failed transcription does not leave the one
 * recording nobody ever got any use from.
 *
 * `expo-file-system` is the same shape of trap as `expo-contacts`: the legacy
 * `deleteAsync` still exports and is documented as throwing at runtime, so this
 * uses the `File` class the SDK 57 module actually implements.
 */
function discard(uri: string | null): void {
  if (!uri) return;
  try {
    new File(uri).delete();
  } catch {
    // A recording that was never written, or already collected. Nothing to do,
    // and nothing worth interrupting the owner over.
  }
}

export function useVoice(onHeard: (text: string) => void): Voice {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [state, setState] = useState<VoiceState>('idle');
  const [problem, setProblem] = useState<string | null>(null);

  const start = useCallback(() => {
    void (async () => {
      setProblem(null);
      try {
        const granted = await requestRecordingPermissionsAsync();
        if (!granted.granted) {
          setProblem('Microphone access is off for Counter in your phone settings.');
          return;
        }

        /*
          Both flags matter, for different reasons. Without `allowsRecording` the
          session never enters a recording mode and Android hands back silence;
          without `playsInSilentMode` an iPhone with the ringer switch down
          records nothing at all — a bug that only ever appears on somebody
          else's phone.
        */
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });

        await recorder.prepareToRecordAsync();
        recorder.record();
        setState('listening');
      } catch (err) {
        setState('idle');
        setProblem(err instanceof Error ? err.message : 'Could not start recording.');
      }
    })();
  }, [recorder]);

  const stop = useCallback(() => {
    void (async () => {
      setState('thinking');
      let recording: string | null = null;
      try {
        await recorder.stop();
        recording = recorder.uri;

        // Hand the audio session back before the network wait, not after.
        void setAudioModeAsync({ allowsRecording: false }).catch(() => {});

        if (!recording) {
          setProblem('Nothing was recorded.');
          return;
        }

        const heard = await transcribe(recording);
        onHeard(heard.text);
      } catch (err) {
        setProblem(err instanceof AiError ? err.message : 'Could not make out what was said.');
      } finally {
        discard(recording);
        setState('idle');
      }
    })();
  }, [recorder, onHeard]);

  const clearProblem = useCallback(() => setProblem(null), []);

  return { state, problem, clearProblem, start, stop };
}
