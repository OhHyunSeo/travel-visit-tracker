import { useEffect, useState } from 'react';
import { Alert, Platform, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useAuthStore } from '../src/store/useAuthStore';
import { useAppStore } from '../src/store/useAppStore';
import { getRepository } from '../src/storage/database';
import { sessionOwner } from '../src/services/authClient';
import { Button } from '../src/ui/Button';
import { colors, styles } from '../src/ui/theme';

export default function AccountScreen() {
  const auth = useAuthStore(),
    app = useAppStore();
  const [signup, setSignup] = useState(false);
  const [apiUrl, setApiUrl] = useState(auth.session?.apiUrl ?? '');
  const [email, setEmail] = useState(auth.session?.user.email ?? '');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [guest, setGuest] = useState({ visits: 0, photos: 0 });
  useEffect(() => {
    let current = true;
    void getRepository()
      .then((repository) => repository.guestRecordCounts())
      .then((value) => {
        if (current) setGuest(value);
      })
      .catch(() => {
        if (current) setGuest({ visits: 0, photos: 0 });
      });
    return () => {
      current = false;
    };
  }, [auth.session, auth.notice]);
  const input = { style: [styles.text, styles.card], placeholderTextColor: colors.muted };
  const importRecords = () => {
    if (!auth.session) return;
    const owner = sessionOwner(auth.session);
    Alert.alert(
      '게스트 기록을 이 계정으로 옮길까요?',
      `${auth.session.user.email}\n방문 ${guest.visits}개와 사진 ${guest.photos}개를 옮깁니다. 이후 로그아웃해도 계정 기록으로 보관되며, 서버 백업은 아직 연결 전입니다.`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '이 계정으로 옮기기',
          onPress: () => {
            void app.importGuest(owner);
          },
        },
      ],
    );
  };
  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <Button title="지도로 돌아가기" secondary onPress={() => router.back()} />
        <Text style={styles.title}>내 기록 계정</Text>
        <Text style={styles.body}>
          로그인은 선택입니다. 로그인하지 않아도 방문을 기기에 기록할 수 있습니다. 계정을 바꾸면
          자동 기록을 멈추고 해당 계정의 기록을 엽니다.
        </Text>
        <Text style={styles.body}>
          현재는 로그인과 기기 안의 기록 연결을 준비했습니다. 서버로 방문과 사진을 보내는 백업은
          다음 작업입니다.
        </Text>
        {auth.notice && <Text style={styles.body}>{auth.notice}</Text>}
        {auth.session && (
          <View style={styles.card}>
            <Text style={styles.heading}>{auth.session.user.username}</Text>
            <Text style={styles.body}>{auth.session.user.email}</Text>
            <Text style={styles.body}>
              {auth.status === 'expired'
                ? '로그인 정보가 만료됐습니다. 기기의 기록은 유지하며 다시 로그인해야 합니다.'
                : auth.status === 'offline'
                  ? '서버 연결 확인 전입니다. 기기의 계정 기록은 볼 수 있습니다.'
                  : '로그인한 계정의 기기 기록을 보고 있습니다.'}
            </Text>
            <Button
              title="로그인 상태 확인"
              secondary
              disabled={app.busy}
              onPress={() => {
                void app.checkAccount();
              }}
            />
            <Text style={styles.body}>
              게스트 GPS 방문 {guest.visits}개 · 사진 {guest.photos}개
            </Text>
            <Button
              title="게스트 기록 가져오기"
              disabled={
                app.busy || !guest.visits || auth.status === 'expired' || Platform.OS === 'web'
              }
              onPress={importRecords}
            />
            <Button
              title="로그아웃하고 게스트 기록 보기"
              secondary
              disabled={app.busy}
              onPress={() => {
                void app.logout();
              }}
            />
          </View>
        )}
        {Platform.OS === 'web' ? (
          <Text style={styles.body}>
            로그인과 안전한 토큰 보관은 휴대폰 앱에서 사용할 수 있습니다.
          </Text>
        ) : (
          <View style={styles.card}>
            <Text style={styles.heading}>
              {signup ? '계정 만들기' : auth.session ? '다시 로그인하거나 계정 바꾸기' : '로그인'}
            </Text>
            <TextInput
              {...input}
              accessibilityLabel="백업 서버 주소"
              placeholder="https://서버 주소"
              value={apiUrl}
              onChangeText={setApiUrl}
              keyboardType="url"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {__DEV__ && (
              <Text style={styles.body}>
                개발 빌드에서는 로컬 HTTP 서버 주소를 사용할 수 있습니다. 출시용 연결은 HTTPS를
                사용합니다.
              </Text>
            )}
            <TextInput
              {...input}
              accessibilityLabel="이메일"
              placeholder="이메일"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="username"
            />
            {signup && (
              <TextInput
                {...input}
                accessibilityLabel="닉네임"
                placeholder="닉네임"
                value={username}
                onChangeText={setUsername}
              />
            )}
            <TextInput
              {...input}
              accessibilityLabel="비밀번호"
              placeholder="비밀번호"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              textContentType={signup ? 'newPassword' : 'password'}
            />
            <Button
              title={signup ? '계정 만들기' : '로그인'}
              disabled={
                app.busy ||
                !apiUrl.trim() ||
                !email.trim() ||
                !password ||
                (signup && !username.trim())
              }
              onPress={() => {
                void app
                  .signIn(apiUrl, email, password, signup ? username : undefined)
                  .finally(() => setPassword(''));
              }}
            />
            <Button
              title={signup ? '기존 계정으로 로그인' : '새 계정 만들기'}
              secondary
              disabled={app.busy}
              onPress={() => setSignup(!signup)}
            />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
