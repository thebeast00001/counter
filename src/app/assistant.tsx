import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { ArrowLeft, Check, Cpu, ExternalLink, EyeOff, RefreshCw, Server, Sparkles, X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Press } from '@/components/Press';
import { TextField } from '@/components/TextField';
import { getKey, getModel, looksLikeKey, looksLikeModelId, setKey, setModel } from '@/ai/keys';
import { freeModelRows, verifyKey, type FreeModel } from '@/ai/provider';
import { curtain } from '@/ai/redact';
import { useMotion } from '@/design/motion';
import { useColors } from '@/design/theme';
import { radius, space } from '@/design/tokens';
import { useBarInset } from '@/state/dock';
import { useBusiness } from '@/state/business';
import { useUndo } from '@/state/undo';

const SIGNUP = 'https://dashboard.sarvam.ai/admin';

/**
 * Connecting a model.
 *
 * The screen leads with what leaves the phone rather than with the feature,
 * because that is the question an owner should be asking and most apps bury it.
 * The example is generated from their own records, live — an abstract promise
 * about "anonymisation" is worth much less than seeing your own customer's name
 * replaced with `P4` before you agree to anything.
 */
export default function AssistantScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const barInset = useBarInset();
  const { enter } = useMotion();
  const { data } = useBusiness();
  const { offerUndo } = useUndo();

  const [draft, setDraft] = useState('');
  const [connected, setConnected] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; detail: string; kind?: string } | null>(null);
  const [models, setModels] = useState<FreeModel[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [modelDraft, setModelDraft] = useState('');
  const [loadingModels, setLoadingModels] = useState(false);

  useEffect(() => {
    let live = true;
    getKey().then((k) => {
      if (live) setConnected(Boolean(k));
    });
    getModel().then((m) => {
      if (live) setChosen(m);
    });
    return () => {
      live = false;
    };
  }, []);

  const loadModels = () => {
    setLoadingModels(true);
    freeModelRows()
      .then(setModels)
      .catch(() => setModels(null))
      .finally(() => setLoadingModels(false));
  };

  const pick = (id: string | null) => {
    setModel(id);
    setChosen(id);
    setModelDraft('');
  };

  // A real sample, from real records, redacted exactly as it would be in flight.
  const sample = (() => {
    const person = data.parties[3] ?? data.parties[0];
    if (!person) return null;
    const question = `How much has ${person.name} paid me this year?`;
    return { before: question, after: curtain(data).hide(question) };
  })();

  const connect = async () => {
    if (!looksLikeKey(draft)) {
      setStatus({ ok: false, detail: 'That does not look like a key. Paste the whole thing.' });
      return;
    }
    setBusy(true);
    setStatus(null);
    await setKey(draft);
    const result = await verifyKey();
    setStatus(result);
    if (result.ok) {
      setConnected(true);
      setDraft('');
      loadModels();
    } else if (result.kind === 'policy') {
      // The key itself is fine — the account just will not serve free models yet.
      // Deleting it would send the owner off to make a second key that fails in
      // exactly the same way, which is the wrong lesson entirely.
      setConnected(true);
    } else {
      // A key that does not work is worse than none — it turns every unrecognised
      // question into a failed round trip instead of an honest "not recognised".
      await setKey(null);
      setConnected(false);
    }
    setBusy(false);
  };

  const disconnect = async () => {
    await setKey(null);
    setConnected(false);
    setStatus(null);
    setModels(null);
    offerUndo('Model disconnected', () => {});
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.bg, paddingTop: insets.top }]}>
      <View style={styles.bar}>
        <Press
          haptic="light"
          scaleTo={0.9}
          onPress={() => router.back()}
          accessibilityLabel="Back"
          style={[styles.iconButton, { backgroundColor: colors.surface }]}>
          <ArrowLeft size={19} color={colors.text} strokeWidth={2.2} />
        </Press>
        <AppText variant="title3">Assistant</AppText>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + barInset }]}>
        <Animated.View entering={enter(0)} style={styles.gutter}>
          <AppText variant="body" color="textDim" style={styles.lede}>
            The app answers most questions by itself, instantly and offline. Connecting a model only
            helps with the ones it does not recognise — working out which figures you meant, and
            writing the sentence.
          </AppText>
        </Animated.View>

        {/* ------------------------------------------------- what is sent -- */}
        <Animated.View entering={enter(1)} style={styles.gutter}>
          <Card tone="surface">
            <View style={styles.headRow}>
              <View style={[styles.icon, { backgroundColor: colors.successSoft }]}>
                <EyeOff size={15} color={colors.success} strokeWidth={2} />
              </View>
              <AppText variant="title3" style={styles.grow}>
                What leaves this phone
              </AppText>
            </View>

            {sample ? (
              <View style={styles.sample}>
                <AppText variant="caption" color="textFaint">
                  YOU TYPE
                </AppText>
                <AppText variant="callout" style={styles.sampleLine}>
                  {sample.before}
                </AppText>
                <AppText variant="caption" color="textFaint" style={styles.sampleGap}>
                  WHAT IS SENT
                </AppText>
                <AppText variant="callout" tint={colors.success} style={styles.sampleLine}>
                  {sample.after}
                </AppText>
              </View>
            ) : null}

            <AppText variant="footnote" color="textDim" style={styles.note}>
              Names and numbers are swapped for tokens before the request and put back after it
              returns. The model never sees who anyone is — and it is never asked for a figure, only
              for which of your own records to read. Every amount you see is still counted by this
              phone.
            </AppText>
          </Card>
        </Animated.View>

        {/* ------------------------------------------------------- the key -- */}
        <Animated.View entering={enter(2)} style={styles.gutter}>
          <Card tone="surface">
            <View style={styles.headRow}>
              <View style={[styles.icon, { backgroundColor: colors.accentSoft }]}>
                <Sparkles size={15} color={colors.accent} strokeWidth={2} />
              </View>
              <AppText variant="title3" style={styles.grow}>
                {connected ? 'Model connected' : 'Connect a model'}
              </AppText>
              {connected ? (
                <View style={[styles.pill, { backgroundColor: colors.successSoft }]}>
                  <Check size={12} color={colors.success} strokeWidth={2.6} />
                </View>
              ) : null}
            </View>

            {connected ? (
              <>
                <AppText variant="footnote" color="textDim" style={styles.note}>
                  Your key is held in this phone&apos;s secure hardware. Requests go straight from
                  here to Sarvam on your own account — there is no server in between belonging
                  to this app.

                </AppText>
                <Button label="Disconnect" variant="danger" onPress={disconnect} />
              </>
            ) : (
              <>
                <AppText variant="footnote" color="textDim" style={styles.note}>
                  Sarvam is an Indian provider, so the request and the answer stay in the
                  country. Make a key on their dashboard and paste it here. It is yours, not
                  ours, and it never goes anywhere except Sarvam.
                </AppText>

                <Press
                  haptic="light"
                  scaleTo={0.97}
                  onPress={() => {
                    WebBrowser.openBrowserAsync(SIGNUP).catch(() => {});
                  }}
                  style={[styles.link, { backgroundColor: colors.surfaceHigh }]}>
                  <ExternalLink size={14} color={colors.accent} strokeWidth={2.2} />
                  <AppText variant="footnote" tint={colors.accent}>
                    Get a key at sarvam.ai
                  </AppText>
                </Press>

                <View style={styles.field}>
                  <TextField
                    label="API key"
                    placeholder="sk-or-v1-…"
                    value={draft}
                    onChangeText={setDraft}
                    autoCapitalize="none"
                    autoCorrect={false}
                    secureTextEntry
                    onSubmitEditing={connect}
                  />
                </View>

                {busy ? (
                  <View style={styles.busy}>
                    <ActivityIndicator size="small" color={colors.textFaint} />
                    <AppText variant="footnote" color="textDim">
                      Checking the key…
                    </AppText>
                  </View>
                ) : (
                  <Button label="Connect" onPress={connect} disabled={draft.trim().length === 0} />
                )}
              </>
            )}

            {status ? (
              <View style={styles.status}>
                {status.ok ? (
                  <Check size={13} color={colors.success} strokeWidth={2.6} />
                ) : (
                  <X size={13} color={colors.warn} strokeWidth={2.6} />
                )}
                <AppText
                  variant="footnote"
                  tint={status.ok ? colors.success : colors.warn}
                  style={styles.grow}>
                  {status.detail}
                </AppText>
              </View>
            ) : null}

            {/*
              This branch linked to OpenRouter's privacy settings, where free
              models had to be opted into and the rejection looked exactly like
              a bad key. Sarvam has no such switch, so there is no page to send
              anyone to — the message is left to say what the service said,
              which is more use than a link to a setting that does not exist.
            */}
            {status?.kind === 'policy' ? (
              <AppText variant="footnote" color="textDim" style={styles.note}>
                {status.detail}
              </AppText>
            ) : null}
          </Card>
        </Animated.View>

        {/* ----------------------------------------------------- the model -- */}
        {connected ? (
          <Animated.View entering={enter(3)} style={styles.gutter}>
            <Card tone="surface">
              <View style={styles.headRow}>
                <View style={[styles.icon, { backgroundColor: colors.surfaceHigh }]}>
                  <Cpu size={15} color={colors.textDim} strokeWidth={2} />
                </View>
                <AppText variant="title3" style={styles.grow}>
                  Which model
                </AppText>
                <Press
                  haptic="light"
                  scaleTo={0.9}
                  onPress={loadModels}
                  accessibilityLabel="Refresh the model list"
                  style={[styles.pill, { backgroundColor: colors.surfaceHigh }]}>
                  <RefreshCw size={12} color={colors.textDim} strokeWidth={2.4} />
                </Press>
              </View>

              <AppText variant="footnote" color="textDim" style={styles.note}>
                {chosen
                  ? 'Pinned. Everything goes to this model first, and falls back to the free list only if it refuses.'
                  : 'Choosing automatically — whichever free model has the most room, with the rest as backup. Pin one if you have a preference.'}
              </AppText>

              {/* The current choice, always visible and always clearable. */}
              <Press
                haptic="light"
                scaleTo={0.98}
                onPress={() => pick(null)}
                disabled={!chosen}
                style={[
                  styles.choice,
                  {
                    backgroundColor: chosen ? colors.accentSoft : colors.surfaceHigh,
                    borderColor: chosen ? colors.accent : 'transparent',
                  },
                ]}>
                <AppText
                  variant="callout"
                  tint={chosen ? colors.accent : colors.text}
                  numberOfLines={1}
                  style={styles.grow}>
                  {chosen ?? 'Automatic'}
                </AppText>
                {chosen ? <X size={14} color={colors.accent} strokeWidth={2.4} /> : null}
              </Press>

              {/* Paste an id — the route that works for any model, free or paid. */}
              <View style={styles.field}>
                <TextField
                  label="Paste a model id"
                  hint="from sarvam.ai"
                  placeholder="vendor/model:free"
                  value={modelDraft}
                  onChangeText={setModelDraft}
                  autoCapitalize="none"
                  autoCorrect={false}
                  onSubmitEditing={() => {
                    if (looksLikeModelId(modelDraft)) pick(modelDraft.trim());
                  }}
                />
              </View>
              {modelDraft.trim().length > 0 ? (
                <Button
                  label={looksLikeModelId(modelDraft) ? 'Use this model' : 'That is not a model id'}
                  disabled={!looksLikeModelId(modelDraft)}
                  onPress={() => pick(modelDraft.trim())}
                />
              ) : null}

              {/* Or tap one from the live roster, so nobody has to type at all. */}
              {loadingModels ? (
                <View style={styles.busy}>
                  <ActivityIndicator size="small" color={colors.textFaint} />
                  <AppText variant="footnote" color="textDim">
                    Fetching what is free right now…
                  </AppText>
                </View>
              ) : models && models.length > 0 ? (
                <View style={styles.list}>
                  <AppText variant="caption" color="textFaint" style={styles.listHead}>
                    {models.length} FREE RIGHT NOW
                  </AppText>
                  {models.slice(0, 12).map((m) => (
                    <Press
                      key={m.id}
                      haptic="light"
                      scaleTo={0.98}
                      onPress={() => pick(m.id)}
                      style={[
                        styles.modelRow,
                        {
                          backgroundColor:
                            chosen === m.id ? colors.accentSoft : colors.surfaceHigh,
                        },
                      ]}>
                      <View style={styles.grow}>
                        <AppText variant="callout" numberOfLines={1}>
                          {m.label}
                        </AppText>
                        <AppText variant="caption" color="textFaint" numberOfLines={1}>
                          {m.id}
                          {m.reasoning ? ' · thinks first, slower and costlier' : ''}
                        </AppText>
                      </View>
                      {chosen === m.id ? (
                        <Check size={14} color={colors.accent} strokeWidth={2.6} />
                      ) : null}
                    </Press>
                  ))}
                </View>
              ) : (
                <Press
                  haptic="light"
                  scaleTo={0.97}
                  onPress={loadModels}
                  style={[styles.link, { backgroundColor: colors.surfaceHigh }]}>
                  <AppText variant="footnote" tint={colors.accent}>
                    Show what is free right now
                  </AppText>
                </Press>
              )}
            </Card>
          </Animated.View>
        ) : null}

        {/* ------------------------------------------------------ the cost -- */}
        <Animated.View entering={enter(4)} style={styles.gutter}>
          <Card tone="surface">
            <View style={styles.headRow}>
              <View style={[styles.icon, { backgroundColor: colors.surfaceHigh }]}>
                <Server size={15} color={colors.textDim} strokeWidth={2} />
              </View>
              <AppText variant="title3" style={styles.grow}>
                Worth knowing
              </AppText>
            </View>
            <AppText variant="footnote" color="textDim" style={styles.note}>
              Free models are rate-limited and can be busy — the app tries several in turn and falls
              back to answering by itself. Providers may train on free-tier traffic, which is exactly
              why nothing identifying is sent. Everything in the app keeps working with no key and no
              signal.
            </AppText>
          </Card>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.gutter,
    paddingVertical: space.md,
  },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },

  scroll: { paddingTop: space.sm, gap: space.base },
  gutter: { paddingHorizontal: space.gutter },
  lede: { lineHeight: 22, marginBottom: space.xs },

  headRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.md },
  icon: { width: 30, height: 30, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  grow: { flex: 1 },
  pill: { width: 22, height: 22, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },

  sample: { gap: 2, marginBottom: space.md },
  sampleGap: { marginTop: space.md },
  sampleLine: { lineHeight: 21 },

  note: { lineHeight: 19, marginBottom: space.md },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingVertical: space.md,
    paddingHorizontal: space.base,
    borderRadius: radius.md,
    marginBottom: space.md,
  },
  linkText: { flex: 1, lineHeight: 18 },

  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.base,
    paddingVertical: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    marginBottom: space.md,
  },
  list: { gap: space.sm, marginTop: space.sm },
  listHead: { letterSpacing: 0.9, marginBottom: space.xs },
  modelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.sm,
  },
  field: { marginBottom: space.md },
  busy: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.md },
  status: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.md },
});
