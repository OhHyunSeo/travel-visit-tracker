import React, { useEffect, useRef } from 'react';
import { NativeModules } from 'react-native';
import { Slot, usePathname, useSegments } from 'expo-router';

export default function FixtureLayout() {
  const pathname = usePathname();
  const segments = useSegments();
  const reported = useRef(false);
  useEffect(() => {
    if (!reported.current && pathname === '/' && segments[0] === '(tabs)') {
      reported.current = true;
      NativeModules.TPRecoveryReport.publishMapRoute();
    }
  }, [pathname, segments]);
  return <Slot />;
}
