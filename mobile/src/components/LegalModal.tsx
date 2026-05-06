import { useEffect } from 'react';
import { Linking } from 'react-native';

const PRIVACY_POLICY_URL = 'https://farmstand.online/privacy-policy';
const TERMS_OF_SERVICE_URL = 'https://farmstand.online/terms-of-service';

type LegalType = 'terms' | 'privacy';

interface LegalModalProps {
  visible: boolean;
  type: LegalType;
  onClose: () => void;
}

export function LegalModal({ visible, type, onClose }: LegalModalProps) {
  useEffect(() => {
    if (!visible) return;
    const url = type === 'terms' ? TERMS_OF_SERVICE_URL : PRIVACY_POLICY_URL;
    Linking.openURL(url).catch((e) => console.warn('[LegalModal] openURL failed', e));
    onClose();
  }, [visible, type]);
  return null;
}
