import React, { useEffect, useState } from 'react';
import { AppRegistry, NativeModules, StyleSheet, Text, View } from 'react-native';
import { Camera, Map, TransformRequestManager } from '@maplibre/maplibre-react-native';

function Trial({ origin }) {
  const [ready, setReady] = useState(false);
  const [rendered, setRendered] = useState(false);
  useEffect(() => {
    const transform = TransformRequestManager.addUrlTransform({
      id: 'tp-rn-qa-entry',
      find: '/resource/style/rn-entry$',
      replace: '/resource/style/sdk',
    });
    setReady(true);
    return () => TransformRequestManager.removeUrlTransform(transform);
  }, []);

  const path = rendered ? 'empty' : 'rn-entry';
  return (
    <View style={styles.screen}>
      <Text style={styles.label}>{rendered ? '지도 렌더 이벤트 수신' : '지도 연결 시험 중'}</Text>
      {ready && (
        <Map style={styles.map} mapStyle={`${origin}/resource/style/${path}`}
          onDidFinishRenderingMapFully={async () => {
            if (!rendered && await NativeModules.TPRNProbe.confirmRendered()) setRendered(true);
          }}>
          <Camera initialViewState={{ center: [0, 0], zoom: 0 }} />
        </Map>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#101817' },
  label: { color: '#fff', marginTop: 64, marginHorizontal: 20 },
  map: { flex: 1, marginTop: 12 },
});

AppRegistry.registerComponent('TPRNMapQA', () => Trial);
