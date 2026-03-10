import { StyleSheet } from 'react-native';

// Design tokens for Settings screens
export const settingsColors = {
  // Backgrounds
  pageBackground: '#FDF8F3',
  cardBackground: '#FFFFFF',
  inputBackground: '#F6F4F0',

  // Primary (Farmstand green)
  primary: '#4A7C59',
  primaryPressed: '#3a6347',
  primaryLight: 'rgba(74, 124, 89, 0.08)',

  // Text
  textPrimary: '#2C2420',
  textSecondary: '#57534E',
  textMuted: '#A8906E',
  textPlaceholder: '#C4B5A5',

  // Borders
  inputBorder: 'rgba(0,0,0,0.07)',
  secondaryBorder: 'rgba(74,124,89,0.35)',

  // Danger
  danger: '#DC2626',
  dangerBackground: 'rgba(220,38,38,0.08)',
  dangerBorder: 'rgba(220,38,38,0.2)',

  // Header — now light to match Saved/Inbox style
  headerBackground: '#FDF8F3',
  headerText: '#4A7C59',
  headerBorder: '#EDE8E0',

  // Shadows
  shadowColor: 'rgba(0,0,0,0.05)',
};

export const settingsStyles = StyleSheet.create({
  // Page container
  pageContainer: {
    flex: 1,
    backgroundColor: settingsColors.pageBackground,
  },

  // Header — light style matching Saved/Inbox
  header: {
    backgroundColor: settingsColors.headerBackground,
    borderBottomWidth: 1,
    borderBottomColor: settingsColors.headerBorder,
  },
  headerContent: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 16,
  },
  headerBackButton: {
    alignSelf: 'flex-start',
    padding: 2,
    marginLeft: -2,
    marginBottom: 12,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '700',
    color: '#2C2420',
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    fontSize: 14,
    color: settingsColors.textMuted,
    marginTop: 2,
  },
  headerRightButton: {
    position: 'absolute',
    right: 20,
    bottom: 18,
    padding: 4,
  },
  headerSpacer: {
    width: 40,
  },

  // Content area
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 48,
  },

  // Card
  card: {
    backgroundColor: settingsColors.cardBackground,
    borderRadius: 18,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: settingsColors.textPrimary,
    marginBottom: 14,
  },
  cardBody: {
    fontSize: 15,
    lineHeight: 22,
    color: settingsColors.textSecondary,
  },

  // Row-style input
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 4,
    minHeight: 56,
  },
  inputRowBubble: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#EDF4EF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputRowContent: {
    flex: 1,
    marginLeft: 12,
  },
  inputRowLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: settingsColors.textMuted,
    marginBottom: 4,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  inputRowField: {
    backgroundColor: settingsColors.inputBackground,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: settingsColors.inputBorder,
    paddingHorizontal: 14,
    height: 44,
    fontSize: 16,
    color: settingsColors.textPrimary,
  },

  // Input (legacy)
  inputContainer: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: settingsColors.textMuted,
    marginBottom: 6,
    letterSpacing: 0.6,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: settingsColors.inputBackground,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: settingsColors.inputBorder,
    paddingHorizontal: 14,
    height: 52,
  },
  inputIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: settingsColors.textPrimary,
  },
  inputHelper: {
    fontSize: 12,
    color: settingsColors.textMuted,
    marginTop: 6,
  },
  inputError: {
    fontSize: 12,
    color: settingsColors.danger,
    marginTop: 6,
  },

  // Buttons
  primaryButton: {
    width: '100%',
    height: 54,
    borderRadius: 16,
    backgroundColor: settingsColors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonPressed: {
    backgroundColor: settingsColors.primaryPressed,
  },
  primaryButtonDisabled: {
    opacity: 0.5,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  secondaryButton: {
    width: '100%',
    height: 54,
    borderRadius: 16,
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: settingsColors.secondaryBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: settingsColors.primary,
  },

  dangerButton: {
    width: '100%',
    height: 54,
    borderRadius: 16,
    backgroundColor: settingsColors.dangerBackground,
    borderWidth: 1,
    borderColor: settingsColors.dangerBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dangerButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: settingsColors.danger,
  },

  // Info text
  infoText: {
    fontSize: 13,
    color: settingsColors.textMuted,
    lineHeight: 19,
  },

  // Reading content (Privacy, Terms)
  readingTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: settingsColors.textPrimary,
    marginBottom: 16,
  },
  readingHeading: {
    fontSize: 15,
    fontWeight: '700',
    color: settingsColors.textPrimary,
    marginTop: 20,
    marginBottom: 8,
  },
  readingBody: {
    fontSize: 15,
    lineHeight: 24,
    color: '#57534E',
  },
  readingMeta: {
    fontSize: 13,
    color: settingsColors.textMuted,
    marginBottom: 16,
  },
});

