import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Platform, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme';
import { getCurrentUser, signOut } from '../services/authService';
import {
  connectStrava, disconnectStrava, getStravaTokens, getStravaAthlete,
  handleStravaWebCallback, isStravaConfigured,
} from '../services/stravaService';
import StravaLogo from '../components/StravaLogo';

export default function HomeScreen({ navigation }) {
  const [name, setName]                   = useState(null);
  const [stravaAthlete, setStravaAthlete] = useState(null);
  const [stravaConnected, setStravaConnected] = useState(false);
  const [stravaLoading, setStravaLoading] = useState(false);
  const [stravaError, setStravaError]     = useState(null);

  useEffect(() => {
    getCurrentUser().then(user => {
      const displayName =
        user?.user_metadata?.full_name ||
        user?.user_metadata?.name      ||
        user?.email?.split('@')[0]     || null;
      setName(displayName);
    });
  }, []);

  const loadStrava = useCallback(async () => {
    const tokens = await getStravaTokens();
    if (tokens) {
      setStravaConnected(true);
      const athlete = await getStravaAthlete();
      setStravaAthlete(athlete);
    } else {
      setStravaConnected(false);
      setStravaAthlete(null);
    }
  }, []);

  useEffect(() => {
    loadStrava();
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const code   = params.get('code');
      const scope  = params.get('scope');
      if (code && scope) {
        window.history.replaceState({}, '', window.location.pathname);
        setStravaLoading(true);
        handleStravaWebCallback(code)
          .then(athlete => { setStravaConnected(true); setStravaAthlete(athlete); })
          .catch(err => setStravaError(err.message))
          .finally(() => setStravaLoading(false));
      }
    }
  }, []);

  const handleConnectStrava = async () => {
    setStravaLoading(true);
    setStravaError(null);
    try {
      const athlete = await connectStrava();
      if (athlete) { setStravaConnected(true); setStravaAthlete(athlete); }
    } catch (err) {
      setStravaError(err.message);
    } finally {
      if (Platform.OS !== 'web') setStravaLoading(false);
    }
  };

  const handleDisconnectStrava = async () => {
    await disconnectStrava();
    setStravaConnected(false);
    setStravaAthlete(null);
  };

  const handleSignOut = async () => {
    await signOut();
    navigation.replace('SignIn');
  };

  const firstName = name?.split(' ')[0] ?? null;

  return (
    <SafeAreaView style={s.container}>
      {/* Header */}
      <View style={s.header}>
        <View>
          <Text style={s.greeting}>{firstName ? `Hi, ${firstName}` : 'Paddle'}</Text>
          <Text style={s.subtitle}>Ready to get on the water?</Text>
        </View>
        <TouchableOpacity onPress={handleSignOut} style={s.menuBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={s.menuText}>···</Text>
        </TouchableOpacity>
      </View>

      {/* Plan CTA */}
      <TouchableOpacity
        style={s.planCta}
        onPress={() => navigation.navigate('Planner')}
        activeOpacity={0.88}
      >
        <View style={s.planCtaIcon}>
          <Text style={s.planCtaIconText}>+</Text>
        </View>
        <View style={s.planCtaText}>
          <Text style={s.planCtaTitle}>Plan a paddle</Text>
          <Text style={s.planCtaSub}>AI-powered route suggestions</Text>
        </View>
        <Text style={s.planCtaArrow}>›</Text>
      </TouchableOpacity>

      {/* Actions card */}
      <View style={s.actionsCard}>
        <TouchableOpacity
          style={s.actionRow}
          onPress={() => navigation.navigate('SavedRoutes')}
          activeOpacity={0.75}
        >
          <View style={[s.actionIconWrap, s.actionIconSaved]}>
            <Text style={s.actionIconSymbol}>♥</Text>
          </View>
          <View style={s.actionTextWrap}>
            <Text style={s.actionLabel}>Saved Paddles</Text>
            <Text style={s.actionSub}>Your bookmarked routes</Text>
          </View>
          <Text style={s.actionChevron}>›</Text>
        </TouchableOpacity>

        <View style={s.actionDivider} />

        <TouchableOpacity
          style={[s.actionRow, !stravaConnected && s.actionRowDimmed]}
          onPress={() => navigation.navigate('YourPaddles')}
          activeOpacity={0.75}
        >
          <View style={[s.actionIconWrap, s.actionIconStrava, !stravaConnected && s.actionIconDimmed]}>
            <Text style={s.actionIconSymbol}>⚑</Text>
          </View>
          <View style={s.actionTextWrap}>
            <Text style={[s.actionLabel, !stravaConnected && s.actionLabelDimmed]}>Your Paddles</Text>
            <Text style={s.actionSub}>
              {stravaConnected ? 'Kayaking history from Strava' : 'Connect Strava to see your paddles'}
            </Text>
          </View>
          {!stravaConnected
            ? <View style={s.lockBadge}><Text style={s.lockBadgeText}>Connect</Text></View>
            : <Text style={s.actionChevron}>›</Text>
          }
        </TouchableOpacity>
      </View>

      {/* Connections */}
      <Text style={s.sectionLabel}>CONNECTIONS</Text>
      <View style={s.stravaRow}>
        <View style={s.stravaLogoWrap}>
          <StravaLogo size={18} />
        </View>
        <View style={[s.statusDot, { backgroundColor: stravaConnected ? colors.primary : colors.border }]} />
        <View style={s.stravaLeft}>
          <Text style={s.stravaLabel}>Strava</Text>
          {stravaConnected && stravaAthlete ? (
            <Text style={s.stravaSub}>{stravaAthlete.firstname} {stravaAthlete.lastname} · connected</Text>
          ) : (
            <Text style={s.stravaSub}>{isStravaConfigured() ? 'Not connected' : 'Credentials not set in .env'}</Text>
          )}
          {stravaError ? <Text style={s.stravaErr}>{stravaError}</Text> : null}
        </View>
        {isStravaConfigured() && (
          stravaLoading ? (
            <ActivityIndicator size="small" color={colors.textMuted} />
          ) : stravaConnected ? (
            <TouchableOpacity onPress={handleDisconnectStrava} hitSlop={{ top: 8, bottom: 8, left: 12, right: 0 }}>
              <Text style={s.stravaActionMuted}>Disconnect</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={handleConnectStrava} hitSlop={{ top: 8, bottom: 8, left: 12, right: 0 }}>
              <Text style={s.stravaActionPrimary}>Connect</Text>
            </TouchableOpacity>
          )
        )}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container:    { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 16, paddingTop: 8 },

  header:       { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingVertical: 16 },
  greeting:     { fontSize: 22, fontWeight: '600', color: colors.text },
  subtitle:     { fontSize: 13, fontWeight: '400', color: colors.textMuted, marginTop: 2 },
  menuBtn:      { padding: 4, marginTop: 4 },
  menuText:     { fontSize: 18, fontWeight: '600', color: colors.textMid, letterSpacing: 1 },

  planCta: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: colors.primary, borderRadius: 16,
    paddingHorizontal: 16, paddingVertical: 16, marginBottom: 12,
  },
  planCtaIcon:     { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  planCtaIconText: { fontSize: 22, fontWeight: '300', color: '#fff', lineHeight: 28 },
  planCtaText:     { flex: 1 },
  planCtaTitle:    { fontSize: 15, fontWeight: '600', color: '#fff' },
  planCtaSub:      { fontSize: 11, fontWeight: '400', color: 'rgba(255,255,255,0.75)', marginTop: 1 },
  planCtaArrow:    { fontSize: 22, fontWeight: '300', color: 'rgba(255,255,255,0.6)' },

  actionsCard: {
    backgroundColor: colors.white, borderRadius: 14, borderWidth: 1, borderColor: colors.borderLight,
    shadowColor: '#1e3a8a', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 8, elevation: 2,
    overflow: 'hidden', marginBottom: 20,
  },
  actionRow:        { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 13 },
  actionIconWrap:   { width: 32, height: 32, borderRadius: 9, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  actionIconNeutral:{ backgroundColor: colors.bgDeep },
  actionIconSaved:  { backgroundColor: colors.primaryLight },
  actionIconSymbol: { fontSize: 14, color: colors.textMid, lineHeight: 18 },
  actionTextWrap:   { flex: 1 },
  actionLabel:      { fontSize: 13, fontWeight: '500', color: colors.text },
  actionSub:        { fontSize: 10, fontWeight: '400', color: colors.textMuted, marginTop: 1 },
  actionChevron:    { fontSize: 18, fontWeight: '300', color: colors.textFaint },
  actionDivider:    { height: 0.5, backgroundColor: colors.borderLight, marginLeft: 58 },
  actionIconStrava: { backgroundColor: '#FC4C0218' },
  actionIconDimmed: { opacity: 0.45 },
  actionRowDimmed:  { opacity: 0.7 },
  actionLabelDimmed:{ color: colors.textMuted },
  lockBadge:        { backgroundColor: colors.primaryLight, borderRadius: 6, paddingHorizontal: 9, paddingVertical: 4 },
  lockBadgeText:    { fontSize: 11, fontWeight: '600', color: colors.primary },

  sectionLabel: {
    fontSize: 10, fontWeight: '600', color: colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 8,
  },

  stravaRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.white, borderRadius: 14, borderWidth: 1, borderColor: colors.borderLight,
    padding: 14,
  },
  stravaLogoWrap:      { width: 28, height: 28, borderRadius: 7, backgroundColor: '#FC4C0215', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  stravaLeft:          { flex: 1 },
  statusDot:           { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  stravaLabel:         { fontSize: 13, fontWeight: '500', color: colors.text, marginBottom: 1 },
  stravaSub:           { fontSize: 11, fontWeight: '400', color: colors.textMuted },
  stravaErr:           { fontSize: 10, fontWeight: '400', color: colors.warn, marginTop: 2 },
  stravaActionPrimary: { fontSize: 12.5, fontWeight: '600', color: colors.primary },
  stravaActionMuted:   { fontSize: 12.5, fontWeight: '400', color: colors.textMuted },
});
