import { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Image, Platform,
} from 'react-native';
import * as Sentry from '@sentry/react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fontFamily } from '../theme';
import { getCurrentUser, signOut } from '../services/authService';
import { getStravaTokens } from '../services/stravaService';
import { SearchIcon, PaddleIcon, DrawIcon, ChatIcon } from '../components/Icons';

export default function HomeScreen({ navigation }) {
  const [name, setName]                       = useState(null);
  const [stravaConnected, setStravaConnected] = useState(false);

  useEffect(() => {
    getCurrentUser().then(user => {
      const displayName =
        user?.user_metadata?.full_name ||
        user?.user_metadata?.name      ||
        user?.email?.split('@')[0]     || null;
      setName(displayName);
    });
  }, []);

  useEffect(() => {
    getStravaTokens().then(tokens => setStravaConnected(!!tokens));
  }, []);

  const handleSignOut = async () => {
    await signOut();
    navigation.replace('SignIn');
  };

  const firstName = name?.split(' ')[0] ?? null;

  return (
    <View style={s.bgImage}>
      <Image
        source={require('../../assets/coast.jpg')}
        style={s.bgImageInner}
        resizeMode="cover"
      />
      {/* Greyscale desaturation overlay (iOS — CSS filter not supported) */}
      <View style={s.bgGreyscale} />
      <View style={s.bgOverlay} />
      <SafeAreaView style={s.container}>
      {/* Header */}
      <View style={s.header}>
        <View>
          <Text style={s.appName}>Solvaa</Text>
          {firstName && <Text style={s.greeting}>Hi, {firstName}</Text>}
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

      {/* Draw a route CTA */}
      <TouchableOpacity
        style={s.drawCta}
        onPress={() => navigation.navigate('SavedRoutes', { drawNew: true })}
        activeOpacity={0.88}
      >
        <View style={s.drawCtaIcon}>
          <DrawIcon size={16} color={colors.primary} />
        </View>
        <View style={s.planCtaText}>
          <Text style={s.drawCtaTitle}>Draw a route</Text>
          <Text style={s.drawCtaSub}>Freehand on the map, no search needed</Text>
        </View>
        <Text style={s.planCtaArrow}>{'\u203A'}</Text>
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
          style={s.actionRow}
          onPress={() => navigation.navigate('SavedSearches')}
          activeOpacity={0.75}
        >
          <View style={[s.actionIconWrap, s.actionIconSaved]}>
            <SearchIcon size={16} color={colors.primary} />
          </View>
          <View style={s.actionTextWrap}>
            <Text style={s.actionLabel}>Saved Searches</Text>
            <Text style={s.actionSub}>Re-open previous route searches</Text>
          </View>
          <Text style={s.actionChevron}>›</Text>
        </TouchableOpacity>

        <View style={s.actionDivider} />

        <TouchableOpacity
          style={s.actionRow}
          onPress={() => navigation.navigate('CompletedPaddles')}
          activeOpacity={0.75}
        >
          <View style={[s.actionIconWrap, s.actionIconSaved]}>
            <PaddleIcon size={16} color={colors.primary} />
          </View>
          <View style={s.actionTextWrap}>
            <Text style={s.actionLabel}>Completed Paddles</Text>
            <Text style={s.actionSub}>Your paddle history on a map</Text>
          </View>
          <Text style={s.actionChevron}>›</Text>
        </TouchableOpacity>

        <View style={s.actionDivider} />

        <TouchableOpacity
          style={s.actionRow}
          onPress={() => navigation.navigate('Feedback')}
          activeOpacity={0.75}
        >
          <View style={[s.actionIconWrap, s.actionIconSaved]}>
            <ChatIcon size={16} color={colors.primary} />
          </View>
          <View style={s.actionTextWrap}>
            <Text style={s.actionLabel}>Give Feedback</Text>
            <Text style={s.actionSub}>Help us improve Solvaa</Text>
          </View>
          <Text style={s.actionChevron}>›</Text>
        </TouchableOpacity>

      </View>
    </SafeAreaView>
    </View>
  );
}

const FF = fontFamily;
const s = StyleSheet.create({
  bgImage:      { flex: 1, backgroundColor: colors.bg },
  bgImageInner: {
    position: 'absolute', bottom: 0, left: 0,
    width: '100%', height: '55%',
    opacity: Platform.OS === 'web' ? 0.45 : 0.35,
    ...Platform.select({ web: { filter: 'grayscale(100%)' } }),
  },
  bgGreyscale:  {
    position: 'absolute', bottom: 0, left: 0,
    width: '100%', height: '55%',
    backgroundColor: colors.bg,
    opacity: Platform.OS === 'web' ? 0 : 0.55,
  },
  bgOverlay:    { ...StyleSheet.absoluteFillObject, backgroundColor: colors.bg, opacity: 0.45 },
  container:    { flex: 1, paddingHorizontal: 20, paddingTop: 8 },

  header:       { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingVertical: 16 },
  appName:      { fontSize: 28, fontWeight: '600', fontFamily: FF.semibold, color: colors.text },
  greeting:     { fontSize: 16, fontWeight: '400', fontFamily: FF.regular, color: colors.textMuted, marginTop: 1 },
  subtitle:     { fontSize: 14, fontWeight: '400', fontFamily: FF.regular, color: colors.textMuted, marginTop: 2 },
  menuBtn:      { padding: 4, marginTop: 4 },
  menuText:     { fontSize: 20, fontWeight: '600', fontFamily: FF.semibold, color: colors.textMid, letterSpacing: 1 },

  planCta: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: '#4A6CF7', borderRadius: 18,
    paddingHorizontal: 18, paddingVertical: 18, marginBottom: 12,
  },
  planCtaIcon:     { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  planCtaIconText: { fontSize: 24, fontWeight: '300', fontFamily: FF.light, color: '#fff', lineHeight: 30 },
  planCtaText:     { flex: 1 },
  planCtaTitle:    { fontSize: 17, fontWeight: '600', fontFamily: FF.semibold, color: '#fff' },
  planCtaSub:      { fontSize: 13, fontWeight: '400', fontFamily: FF.regular, color: 'rgba(255,255,255,0.75)', marginTop: 1 },
  planCtaArrow:    { fontSize: 24, fontWeight: '300', fontFamily: FF.light, color: 'rgba(255,255,255,0.6)' },

  drawCta: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: colors.white, borderRadius: 18,
    paddingHorizontal: 18, paddingVertical: 14, marginBottom: 12,
    borderWidth: 1.5, borderColor: colors.border,
    shadowColor: '#1e3a8a', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.04, shadowRadius: 12, elevation: 2,
  },
  drawCtaIcon:  { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  drawCtaTitle: { fontSize: 15, fontWeight: '600', fontFamily: FF.semibold, color: colors.text },
  drawCtaSub:   { fontSize: 12, fontWeight: '400', fontFamily: FF.regular, color: colors.textMuted, marginTop: 1 },

  startPaddleCta: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: colors.white, borderRadius: 18,
    paddingHorizontal: 18, paddingVertical: 16, marginBottom: 12,
    borderWidth: 1.5, borderColor: colors.primary,
    shadowColor: '#1e3a8a', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 12, elevation: 3,
  },
  startPaddleIcon:     { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  startPaddleIconText: { fontSize: 16, color: colors.primary },
  startPaddleTextWrap: { flex: 1 },
  startPaddleTitle:    { fontSize: 15, fontWeight: '600', fontFamily: FF.semibold, color: colors.text },
  startPaddleSub:      { fontSize: 12, fontWeight: '400', fontFamily: FF.regular, color: colors.textMuted, marginTop: 1 },

  actionsCard: {
    backgroundColor: colors.white, borderRadius: 18,
    shadowColor: '#1e3a8a', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 12, elevation: 3,
    overflow: 'hidden', marginBottom: 20,
  },
  actionRow:        { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 18, paddingVertical: 16 },
  actionIconWrap:   { width: 38, height: 38, borderRadius: 11, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  actionIconNeutral:{ backgroundColor: colors.bgDeep },
  actionIconSaved:  { backgroundColor: colors.primaryLight },
  actionIconSymbol: { fontSize: 16, color: colors.primary, lineHeight: 20 },
  actionTextWrap:   { flex: 1 },
  actionLabel:      { fontSize: 15, fontWeight: '500', fontFamily: FF.medium, color: colors.text },
  actionSub:        { fontSize: 12, fontWeight: '400', fontFamily: FF.regular, color: colors.textMuted, marginTop: 1 },
  actionChevron:    { fontSize: 20, fontWeight: '300', fontFamily: FF.light, color: colors.textFaint },
  actionDivider:    { height: 0.5, backgroundColor: colors.borderLight, marginLeft: 70 },
});
