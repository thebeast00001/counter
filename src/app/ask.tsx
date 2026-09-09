import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  CornerDownLeft,
  Search,
  Sparkles,
  WifiOff,
} from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Deep } from '@/components/Deep';
import { Press } from '@/components/Press';
import { TextField } from '@/components/TextField';
import { answer as askModel, type Reply } from '@/ai/engine';
import { getKey } from '@/ai/keys';
import { AiError } from '@/ai/provider';
import { ask, EXAMPLE_QUESTIONS, type Answer } from '@/domain/query';
import { useMotion } from '@/design/motion';
import { useColors } from '@/design/theme';
import { radius, space } from '@/design/tokens';
import { useBarInset } from '@/state/dock';
import { useBusiness } from '@/state/business';

/**
 * Ask anything.
 *
 * The device answers first, always. `query.ts` recognises a bounded set of
 * questions and answers them exactly, in single-digit milliseconds, with no
 * signal and no cost — and that covers most of what an owner actually types.
 *
 * A model is only reached for when the device did not understand, and only if
 * the owner has connected one. It never computes the answer: it picks which
 * lookup to run and phrases the result. Names are replaced with tokens before
 * anything leaves the handset and restored after it returns, so the figures stay
 * exact and the customer list stays here.
 *
 * The screen says which of the two answered, every time. An owner who cannot
 * tell whether a number came from their records or from a language model has no
 * reason to trust either.
 */
export default function AskScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const barInset = useBarInset();
  const { enter } = useMotion();
  const { profile, data } = useBusiness();

  const [question, setQuestion] = useState('');
  const [asked, setAsked] = useState<string | null>(null);
  const [hasKey, setHasKey] = useState(false);

  const [reply, setReply] = useState<Reply | null>(null);
  const [thinking, setThinking] = useState(false);
  const [failed, setFailed] = useState<{ message: string; kind?: string } | null>(null);

  const answer = useMemo<Answer | null>(
    () => (profile && asked ? ask(profile, data, asked) : null),
    [profile, data, asked],
  );

  useEffect(() => {
    let live = true;
    getKey().then((k) => {
      if (live) setHasKey(Boolean(k));
    });
    return () => {
      live = false;
    };
  }, []);

  // Escalate only on a miss. A question the device understood is already
  // answered exactly, and spending a round trip to rephrase it would be slower,
  // less accurate, and pointlessly chatty.
  useEffect(() => {
    if (!profile || !asked || !answer || answer.ok || !hasKey) return;

    let live = true;
    setThinking(true);
    setFailed(null);
    setReply(null);

    askModel(profile, data, asked)
      .then((r) => {
        if (live) setReply(r);
      })
      .catch((err: unknown) => {
        if (!live) return;
        setFailed(
          err instanceof AiError
            ? { message: err.message, kind: err.kind }
            : { message: 'Something went wrong.' },
        );
      })
      .finally(() => {
        if (live) setThinking(false);
      });

    return () => {
      live = false;
    };
  }, [profile, data, asked, answer, hasKey]);

  if (!profile) return null;

  const submit = (text: string) => {
    const trimmed = text.trim();
    if (trimmed.length < 3) return;
    setQuestion(trimmed);
    setAsked(trimmed);
    setReply(null);
    setFailed(null);
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
        <View style={styles.barBody}>
          <AppText variant="title3">Ask</AppText>
          <View style={styles.offline}>
            <WifiOff size={11} color={colors.textFaint} strokeWidth={2} />
            <AppText variant="caption" color="textFaint">
              {hasKey ? 'This phone first, model as backup' : 'Answered on this phone'}
            </AppText>
          </View>
        </View>
      </View>

      <View style={styles.gutter}>
        <View style={[styles.field, { backgroundColor: colors.surface }]}>
          <Search size={17} color={colors.textFaint} strokeWidth={2} />
          <View style={styles.fieldInput}>
            <TextField
              placeholder={`How much did I make last month?`}
              value={question}
              onChangeText={setQuestion}
              onSubmitEditing={() => submit(question)}
              returnKeyType="search"
              // Deliberately not autofocused. The keyboard covering the example
              // questions is exactly backwards: the examples are what teach you
              // which questions this can actually answer.
              bare
            />
          </View>
          {question.trim().length >= 3 ? (
            <Press
              haptic="medium"
              scaleTo={0.9}
              onPress={() => submit(question)}
              accessibilityLabel="Ask"
              style={[styles.go, { backgroundColor: colors.accent }]}>
              <CornerDownLeft size={15} color={colors.accentText} strokeWidth={2.4} />
            </Press>
          ) : null}
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + barInset }]}>
        {answer ? (
          <Animated.View key={asked} entering={enter(0)} style={styles.gutter}>
            {/*
              Echo what was understood, so a misreading is visible rather than
              silent — but only ever about the question.

              "NOT RECOGNISED HERE" sat above whatever the model had said, so a
              network failure was presented as the app failing to understand
              English. Two different problems, one heading, and the one on
              screen was the wrong one: the phone understood the question
              perfectly and could not reach anything to phrase the answer.
            */}
            <AppText variant="caption" color="textFaint" style={styles.understood}>
              {answer.ok
                ? answer.understood.toUpperCase()
                : failed
                  ? 'COULD NOT REACH THE MODEL'
                  : 'NOT RECOGNISED HERE'}
            </AppText>

            {answer.ok ? (
              <>
                {answer.headline ? (
                  <AppText variant="metric" tabular style={styles.headline}>
                    {answer.headline}
                  </AppText>
                ) : null}
                <AppText
                  variant="body"
                  color={answer.headline ? 'textDim' : 'text'}
                  style={styles.detail}>
                  {answer.detail}
                </AppText>
              </>
            ) : (
              <Escalation
                thinking={thinking}
                reply={reply}
                failed={failed}
                hasKey={hasKey}
                fallback={answer.detail}
                onOpenSettings={() => router.push('/assistant')}
              />
            )}

            {answer.rows.length > 0 && (answer.ok || (!hasKey && !reply)) ? (
              <View style={styles.rows}>
                {answer.rows.map((row, i) =>
                  answer.ok ? (
                    <Animated.View key={row.id} entering={enter(i)}>
                      <RowView row={row} />
                    </Animated.View>
                  ) : (
                    <Press
                      key={row.id}
                      haptic="light"
                      scaleTo={0.97}
                      onPress={() => submit(row.label)}
                      style={[styles.example, { backgroundColor: colors.surface }]}>
                      <AppText variant="callout">{row.label}</AppText>
                    </Press>
                  ),
                )}
              </View>
            ) : null}

            {/* People the model mentioned, as real rows the owner can open. */}
            {reply && reply.partyIds.length > 0 ? (
              <View style={styles.rows}>
                {reply.partyIds.slice(0, 8).map((id, i) => {
                  const party = data.parties.find((p) => p.id === id);
                  if (!party) return null;
                  return (
                    <Animated.View key={id} entering={enter(i)}>
                      <RowView row={{ id, label: party.name, partyId: id }} />
                    </Animated.View>
                  );
                })}
              </View>
            ) : null}
          </Animated.View>
        ) : (
          <Animated.View entering={enter(0)} style={styles.gutter}>
            <AppText variant="footnote" color="textDim" style={styles.intro}>
              {hasKey
                ? 'Worked out from your own records, on this device. If a question is not recognised here, a model helps interpret it — it picks which figures to look up and writes the sentence, but never invents a number, and no names ever leave this phone.'
                : 'Everything is worked out from your own records, on this device. Nothing is sent anywhere, which is why it works with no signal — and why it only understands questions about your business.'}
            </AppText>
            <View style={styles.rows}>
              {EXAMPLE_QUESTIONS.map((example, i) => (
                <Animated.View key={example} entering={enter(i)}>
                  <Press
                    haptic="light"
                    scaleTo={0.97}
                    onPress={() => submit(example)}
                    style={[styles.example, { backgroundColor: colors.surface }]}>
                    <AppText variant="callout">{example}</AppText>
                  </Press>
                </Animated.View>
              ))}
            </View>
          </Animated.View>
        )}
      </ScrollView>
    </View>
  );
}

/**
 * What happens after the device says "I do not know".
 *
 * Four states, and all four say plainly where the answer came from — including
 * the one where no model is connected, which offers the option rather than
 * pretending the question was unanswerable.
 */
function Escalation({
  thinking,
  reply,
  failed,
  hasKey,
  fallback,
  onOpenSettings,
}: {
  thinking: boolean;
  reply: Reply | null;
  failed: { message: string; kind?: string } | null;
  hasKey: boolean;
  fallback: string;
  onOpenSettings: () => void;
}) {
  const colors = useColors();

  if (!hasKey) {
    return (
      <View style={styles.block}>
        <AppText variant="body" style={styles.detail}>
          {fallback}
        </AppText>
        <Press
          haptic="light"
          scaleTo={0.97}
          onPress={onOpenSettings}
          style={[styles.suggest, { backgroundColor: colors.accentSoft }]}>
          <Sparkles size={15} color={colors.accent} strokeWidth={2.2} />
          <AppText variant="footnote" tint={colors.accent} style={styles.suggestText}>
            Connect a model in Settings to understand questions like this
          </AppText>
        </Press>
      </View>
    );
  }

  if (thinking) {
    return (
      <View style={[styles.block, styles.thinking]}>
        <ActivityIndicator size="small" color={colors.textFaint} />
        <AppText variant="body" color="textDim">
          Working out which figures you want…
        </AppText>
      </View>
    );
  }

  if (failed) {
    return (
      <View style={styles.block}>
        <AppText variant="body" style={styles.detail}>
          {failed.message}
        </AppText>
        {failed.kind === 'policy' ? (
          /*
            No link any more. This pointed at OpenRouter's free-model opt-in,
            which Sarvam has no equivalent of — and a button that opens a
            settings page the owner does not have an account for is worse than
            the plain message underneath it.
          */
          <AppText variant="footnote" color="textDim" style={styles.detail}>
            Your key is fine — the service refused this request rather than the key.
          </AppText>
        ) : null}
        <AppText variant="footnote" color="textFaint" style={styles.detail}>
          Your records are still here and still exact — only the interpreting step needs a
          connection.
        </AppText>
      </View>
    );
  }

  if (reply) {
    return (
      <View style={styles.block}>
        <AppText variant="body" style={styles.detail}>
          {reply.text}
        </AppText>
        <View style={styles.attribution}>
          <Sparkles size={11} color={colors.textFaint} strokeWidth={2} />
          <AppText variant="caption" color="textFaint">
            Figures from your records{reply.usedTool ? ` · ${reply.usedTool.replace(/_/g, ' ')}` : ''}
            {reply.model ? ` · phrased by ${reply.model.split('/').pop()}` : ''}
          </AppText>
        </View>
      </View>
    );
  }

  return (
    <AppText variant="body" style={styles.detail}>
      {fallback}
    </AppText>
  );
}

function RowView({ row }: { row: { id: string; label: string; sub?: string; value?: string; partyId?: string } }) {
  const colors = useColors();

  const body = (
    <View style={[styles.row, { backgroundColor: colors.surface }]}>
      <View style={styles.rowBody}>
        <AppText variant="callout" numberOfLines={1}>
          {row.label}
        </AppText>
        {row.sub ? (
          <AppText variant="caption" color="textFaint" numberOfLines={1}>
            {row.sub}
          </AppText>
        ) : null}
      </View>
      {row.value ? (
        <AppText variant="callout" tabular>
          {row.value}
        </AppText>
      ) : null}
    </View>
  );

  return row.partyId ? (
    <Deep target={{ kind: 'party', partyId: row.partyId }} haptic="light" scaleTo={0.985}>
      {body}
    </Deep>
  ) : (
    body
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
  barBody: { flex: 1, gap: 2 },
  offline: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },

  gutter: { paddingHorizontal: space.gutter },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingLeft: space.base,
    paddingRight: space.sm,
    borderRadius: radius.pill,
    minHeight: 52,
  },
  fieldInput: { flex: 1 },
  go: { width: 34, height: 34, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },

  scroll: { paddingTop: space.xl },
  intro: { lineHeight: 19, marginBottom: space.lg },
  understood: { letterSpacing: 0.9, marginBottom: space.sm },
  headline: { marginBottom: space.sm },
  detail: { lineHeight: 22 },

  block: { gap: space.md },
  thinking: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  suggest: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.base,
    borderRadius: radius.md,
  },
  suggestText: { flex: 1, lineHeight: 18 },
  attribution: { flexDirection: 'row', alignItems: 'center', gap: space.xs },

  rows: { gap: space.sm, marginTop: space.lg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.base,
    borderRadius: radius.md,
  },
  rowBody: { flex: 1, gap: 2 },
  example: { padding: space.base, borderRadius: radius.md },
});
