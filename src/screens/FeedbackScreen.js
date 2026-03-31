import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { colors, fontFamily, layout } from '../theme';
import { BackIcon, HomeIcon } from '../components/Icons';
import { track } from '../services/analyticsService';

const CATEGORIES = ['Bug', 'Feature Request', 'General'];

export default function FeedbackScreen({ navigation }) {
  const [rating, setRating] = useState(0);
  const [category, setCategory] = useState(null);
  const [comment, setComment] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async () => {
    await track('feedback_submitted', {
      rating,
      category,
      comment,
    });
    setSubmitted(true);
  };

  const canSubmit = rating > 0 && category;

  if (submitted) {
    return (
      <View style={styles.container}>
        <View style={styles.navBar}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12}>
            <BackIcon />
          </TouchableOpacity>
          <Text style={styles.navTitle}>Feedback</Text>
          <TouchableOpacity onPress={() => navigation.navigate('Home')} hitSlop={12}>
            <HomeIcon />
          </TouchableOpacity>
        </View>
        <View style={styles.successContainer}>
          <Text style={styles.successText}>Thanks for your feedback!</Text>
          <TouchableOpacity style={styles.submitButton} onPress={() => navigation.goBack()}>
            <Text style={styles.submitButtonText}>Go back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.navBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12}>
          <BackIcon />
        </TouchableOpacity>
        <Text style={styles.navTitle}>Feedback</Text>
        <TouchableOpacity onPress={() => navigation.navigate('Home')} hitSlop={12}>
          <HomeIcon />
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {/* Star Rating */}
          <View style={styles.card}>
            <Text style={styles.label}>How would you rate your experience?</Text>
            <View style={styles.starsRow}>
              {[1, 2, 3, 4, 5].map((star) => (
                <TouchableOpacity
                  key={star}
                  onPress={() => setRating(star)}
                  style={styles.starTouch}
                >
                  <Text style={[styles.star, star <= rating && styles.starFilled]}>
                    {star <= rating ? '\u2605' : '\u2606'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Category Picker */}
          <View style={styles.card}>
            <Text style={styles.label}>Category</Text>
            <View style={styles.chipsRow}>
              {CATEGORIES.map((cat) => (
                <TouchableOpacity
                  key={cat}
                  onPress={() => setCategory(cat)}
                  style={[styles.chip, category === cat && styles.chipSelected]}
                >
                  <Text style={[styles.chipText, category === cat && styles.chipTextSelected]}>
                    {cat}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Comment */}
          <View style={styles.card}>
            <Text style={styles.label}>Comments</Text>
            <TextInput
              style={styles.textInput}
              placeholder="Tell us more..."
              placeholderTextColor={colors.textSecondary || '#8a8d96'}
              multiline
              numberOfLines={5}
              textAlignVertical="top"
              value={comment}
              onChangeText={setComment}
            />
          </View>

          {/* Submit */}
          <TouchableOpacity
            style={[styles.submitButton, !canSubmit && styles.submitButtonDisabled]}
            onPress={handleSubmit}
            disabled={!canSubmit}
          >
            <Text style={styles.submitButtonText}>Submit Feedback</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg || '#f0f2f5',
  },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 6,
    paddingRight: 8,
    paddingVertical: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.border || '#e0e0e0',
    backgroundColor: colors.white || '#ffffff',
  },
  navTitle: {
    fontFamily: fontFamily?.semibold || 'Poppins-SemiBold',
    fontWeight: '600',
    fontSize: 17,
    color: colors.text || '#1a1d26',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  card: {
    backgroundColor: colors.white || '#ffffff',
    borderRadius: 18,
    padding: 20,
    marginBottom: 16,
    ...(layout?.cardShadow || {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.06,
      shadowRadius: 8,
      elevation: 2,
    }),
  },
  label: {
    fontFamily: fontFamily?.medium || 'Poppins-Medium',
    fontWeight: '500',
    fontSize: 15,
    color: colors.text || '#1a1d26',
    marginBottom: 12,
  },
  starsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  starTouch: {
    padding: 4,
  },
  star: {
    fontSize: 36,
    color: '#ccc',
  },
  starFilled: {
    color: colors.primary || '#4A6CF7',
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border || '#e0e0e0',
    backgroundColor: colors.white || '#ffffff',
  },
  chipSelected: {
    backgroundColor: colors.primary || '#4A6CF7',
    borderColor: colors.primary || '#4A6CF7',
  },
  chipText: {
    fontFamily: fontFamily?.regular || 'Poppins-Regular',
    fontWeight: '400',
    fontSize: 14,
    color: colors.text || '#1a1d26',
  },
  chipTextSelected: {
    color: '#ffffff',
  },
  textInput: {
    fontFamily: fontFamily?.regular || 'Poppins-Regular',
    fontWeight: '400',
    fontSize: 14,
    color: colors.text || '#1a1d26',
    backgroundColor: colors.bg || '#f0f2f5',
    borderRadius: 12,
    padding: 14,
    minHeight: 120,
  },
  submitButton: {
    backgroundColor: colors.primary || '#4A6CF7',
    borderRadius: 18,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 4,
  },
  submitButtonDisabled: {
    opacity: 0.45,
  },
  submitButtonText: {
    fontFamily: fontFamily?.semibold || 'Poppins-SemiBold',
    fontWeight: '600',
    fontSize: 16,
    color: '#ffffff',
  },
  successContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  successText: {
    fontFamily: fontFamily?.semibold || 'Poppins-SemiBold',
    fontWeight: '600',
    fontSize: 20,
    color: colors.text || '#1a1d26',
    marginBottom: 24,
    textAlign: 'center',
  },
});
