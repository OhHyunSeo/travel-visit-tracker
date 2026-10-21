import { useEffect, useState } from 'react';
import { Alert, Platform, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useAuthStore } from '../src/store/useAuthStore';
import { useAppStore, type BackupExpectation } from '../src/store/useAppStore';
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
  const accountOwner = auth.session ? sessionOwner(auth.session) : null;
  const backupVisible = accountOwner !== null && app.backupOwnerId === accountOwner;
  const toggleAutomaticBackup = () => {
    if (!auth.session || !backupVisible) return;
    const expected: BackupExpectation = {
      ownerId: sessionOwner(auth.session),
      token: auth.session.token,
    };
    if (app.backup.autoEnabled) {
      void app.setBackupEnabled(false, expected);
      return;
    }
    Alert.alert(
      '자동 방문 백업을 켤까요?',
      `${auth.session.user.email}\n${auth.session.apiUrl}\n\n이 계정의 방문 기록과 방문 삭제 요청을 앱 화면이 열려 있는 동안 서버로 보냅니다. 사진은 포함하지 않습니다. 사진 전송과 기록 복원은 각각 별도 확인 후 수동으로 실행합니다.`,
      [
        { text: '취소', style: 'cancel' },
        { text: '자동 방문 백업 켜기', onPress: () => void app.setBackupEnabled(true, expected) },
      ],
    );
  };
  const sendPhotos = () => {
    if (!auth.session?.token || !backupVisible) return;
    const expected: BackupExpectation = {
      ownerId: sessionOwner(auth.session),
      token: auth.session.token,
    };
    Alert.alert(
      '사진을 이 계정으로 보낼까요?',
      `${auth.session.user.email}\n${auth.session.apiUrl}\n\n이 계정의 방문 기록과 삭제 요청을 먼저 보낸 뒤, 앱에 보관된 JPEG·PNG 첨부본을 보냅니다. 한 번에 사진 최대 20개의 서버 저장을 확인하며, 파일당 최대 10MiB입니다. HEIC·WebP와 없거나 지원 범위를 넘는 파일은 대기에 남습니다.\n\n전송 중에는 앱 화면을 열어 두세요. 사진을 자동으로 전송하지는 않습니다. 서버에서 기록을 받으려면 기록 복원을 사용해 주세요. 전송이 끝나도 기기의 사진은 보관합니다.`,
      [
        { text: '취소', style: 'cancel' },
        { text: '확인하고 전송', onPress: () => void app.backupPhotos(expected) },
      ],
    );
  };
  const restoreRecords = () => {
    if (!auth.session?.token || !backupVisible) return;
    const expected = { ownerId: sessionOwner(auth.session), token: auth.session.token };
    Alert.alert(
      '이 계정의 기록을 받을까요?',
      `${auth.session.user.email}\n${auth.session.apiUrl}\n\n서버의 방문과 JPEG, PNG 사진을 기기에 받습니다. 서버에서 삭제한 방문은 숨기며 기기의 기존 사진 파일은 보관합니다. 보내지 않은 변경이나 겹치는 기록은 복원 대기에 남습니다.\n\n이전에 받은 사진을 한 번에 최대 20개 점검하고, 없거나 손상된 다운로드는 새 사본으로 연결합니다. 이전 파일은 보관하며 사용자 사진은 바꾸지 않습니다. 한 번에 새 사진을 최대 20개 받습니다. 앱 화면을 열어 두세요. 연결이 끊기면 다시 눌러 이어받을 수 있습니다.`,
      [
        { text: '취소', style: 'cancel' },
        { text: '확인하고 받기', onPress: () => void app.restoreRecords(expected) },
      ],
    );
  };
  const importRecords = () => {
    if (!auth.session) return;
    const owner = sessionOwner(auth.session);
    Alert.alert(
      '게스트 기록을 이 계정으로 옮길까요?',
      `${auth.session.user.email}\n방문 ${guest.visits}개와 사진 ${guest.photos}개를 옮깁니다. 이후 로그아웃해도 계정 기록으로 보관됩니다. 옮긴 방문은 이 계정의 백업 설정에 따라 서버로 전송됩니다. 사진 전송과 기록 복원은 각각 별도 확인 후 수동으로 실행합니다.`,
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
          계정의 방문 기록과 지원하는 사진을 서버로 보낼 수 있습니다. 사진은 별도 확인 후 수동으로
          전송합니다. 서버에 보낸 방문과 JPEG, PNG 사진은 아래 기록 복원에서 받을 수 있습니다.
          보내지 않은 기록과 지원하지 않는 사진은 기기에만 남습니다.
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
        {auth.session && (
          <View style={styles.card}>
            <Text style={styles.heading}>방문 백업</Text>
            <Text style={styles.body}>{auth.session.apiUrl}</Text>
            {backupVisible ? (
              <>
                <Text style={styles.body}>
                  방문 변경사항 {app.backup.pendingVisits}건이 전송을 기다립니다.
                </Text>
                <Text style={styles.body}>
                  사진 변경사항 {app.backup.pendingPhotos}건은 아래 사진 백업에서 따로 보냅니다.
                </Text>
                <Text style={styles.body}>
                  {app.backup.lastSuccessAt === null
                    ? '아직 방문을 전송한 내역이 없습니다.'
                    : `마지막 방문 전송 완료: ${new Date(app.backup.lastSuccessAt).toLocaleString('ko-KR')}`}
                </Text>
                {app.backupBusy && (
                  <Text style={styles.body}>서버 연결과 방문 백업을 확인하고 있습니다.</Text>
                )}
                {app.backupMessage && <Text style={styles.body}>{app.backupMessage}</Text>}
                {app.backup.pauseReason && (
                  <Text style={styles.error}>
                    {app.backup.pauseReason === 'authentication'
                      ? '다시 로그인한 뒤 방문 백업을 눌러 주세요. 대기 기록은 보관 중입니다.'
                      : '서버 기록과 충돌해 자동 백업을 멈췄습니다. 기록을 확인한 뒤 방문 백업을 눌러 주세요.'}
                  </Text>
                )}
                {app.backup.autoEnabled &&
                  !app.backup.pauseReason &&
                  app.backup.nextAttemptAt !== null && (
                    <Text style={styles.body}>
                      다음 백업 확인:{' '}
                      {new Date(
                        Math.min(
                          app.backup.nextAttemptAt,
                          app.backup.connectionCheckAt ?? Infinity,
                        ),
                      ).toLocaleTimeString('ko-KR')}
                    </Text>
                  )}
                <Button
                  title={app.backupBusy ? '백업 확인 중' : '방문 백업하기'}
                  disabled={
                    app.busy ||
                    app.backupBusy ||
                    app.photoBackupBusy ||
                    app.restoreBusy ||
                    !auth.session.token ||
                    Platform.OS === 'web'
                  }
                  onPress={() => {
                    if (auth.session)
                      void app.backupVisits(true, {
                        ownerId: sessionOwner(auth.session),
                        token: auth.session.token,
                      });
                  }}
                />
                <Text style={styles.body}>
                  자동 방문 백업: {app.backup.autoEnabled ? '켜짐' : '꺼짐'}. 켜 두면 앱 화면을 열어
                  둔 동안 전송하고, 연결에 실패하면 잠시 뒤 다시 시도합니다.
                </Text>
                <Button
                  title={app.backup.autoEnabled ? '자동 방문 백업 끄기' : '자동 방문 백업 켜기'}
                  secondary
                  disabled={
                    app.busy ||
                    (!app.backup.autoEnabled && !auth.session.token) ||
                    Platform.OS === 'web'
                  }
                  onPress={toggleAutomaticBackup}
                />
              </>
            ) : (
              <Text style={styles.body}>이 계정의 전송 상태를 읽고 있습니다.</Text>
            )}
          </View>
        )}
        {auth.session && (
          <View style={styles.card}>
            <Text style={styles.heading}>사진 백업</Text>
            <Text style={styles.body}>{auth.session.apiUrl}</Text>
            <Text style={styles.body}>
              앱에 보관된 JPEG·PNG 첨부본을 확인 후 전송합니다. 자동 방문 백업에는 사진이 포함되지
              않습니다. 서버에 보낸 기록은 아래 기록 복원에서 받을 수 있습니다.
            </Text>
            {backupVisible ? (
              <>
                <Text style={styles.body}>
                  전송 대기 {app.photoBackup.pendingPhotos}건 · 서버 저장 확인{' '}
                  {app.photoBackup.backedUpPhotos}개
                </Text>
                <Text style={styles.body}>
                  HEIC·WebP, 없는 파일과 전송 실패는 대기에 남습니다. 형식을 자동으로 바꾸거나
                  기기의 첨부본을 삭제하지 않습니다.
                </Text>
                {app.photoBackupBusy && (
                  <Text style={styles.body}>
                    방문을 확인하고 사진을 전송하고 있습니다. 화면을 열어 두세요.
                  </Text>
                )}
                {app.photoBackupMessage && (
                  <Text style={styles.body}>{app.photoBackupMessage}</Text>
                )}
                <Button
                  title={app.photoBackupBusy ? '사진 전송 중' : '사진 백업하기'}
                  disabled={
                    app.busy ||
                    app.backupBusy ||
                    app.photoBackupBusy ||
                    app.restoreBusy ||
                    !auth.session.token ||
                    Platform.OS === 'web'
                  }
                  onPress={sendPhotos}
                />
              </>
            ) : (
              <Text style={styles.body}>이 계정의 사진 전송 상태를 읽고 있습니다.</Text>
            )}
          </View>
        )}
        {auth.session && (
          <View style={styles.card}>
            <Text style={styles.heading}>기록 복원</Text>
            <Text style={styles.body}>
              이 계정의 서버 기록을 기기에 받습니다. 이전에 받은 다운로드도 점검하고 손상되거나
              없어진 파일은 새 사본으로 연결합니다. 기존 파일과 보내지 않은 변경은 보관합니다.
              기기에만 보관된 기록은 다른 기기에서 받을 수 없습니다.
            </Text>
            {backupVisible ? (
              <>
                <Text style={styles.body}>
                  복원 대기 방문 {app.restore.pendingVisits}건, 사진 {app.restore.pendingPhotos}건
                </Text>
                {app.restore.uncheckedPhotos > 0 && (
                  <Text style={styles.body}>
                    이전에 받은 사진 {app.restore.uncheckedPhotos}개는 점검을 기다립니다. 복원을
                    눌러 이어서 확인할 수 있습니다.
                  </Text>
                )}
                {app.restore.damagedPhotos > 0 && (
                  <Text style={styles.body}>
                    없거나 손상된 다운로드 {app.restore.damagedPhotos}개를 다시 받아야 합니다. 이전
                    파일은 보관합니다.
                  </Text>
                )}
                {app.restore.blocked > 0 && (
                  <Text style={styles.body}>
                    대기 중 {app.restore.blocked}건은 기기의 변경사항이나 파일을 확인해야 합니다.
                    기존 기록은 보관 중입니다.
                  </Text>
                )}
                {app.restoreBusy && (
                  <Text style={styles.body}>
                    서버 기록과 사진을 받고 있습니다. 화면을 열어 두세요.
                  </Text>
                )}
                {app.restoreMessage && <Text style={styles.body}>{app.restoreMessage}</Text>}
                <Button
                  title={app.restoreBusy ? '기록 받는 중' : '기록 복원하기'}
                  disabled={
                    app.busy ||
                    app.backupBusy ||
                    app.photoBackupBusy ||
                    app.restoreBusy ||
                    !auth.session.token ||
                    Platform.OS === 'web'
                  }
                  onPress={restoreRecords}
                />
              </>
            ) : (
              <Text style={styles.body}>이 계정의 복원 대기를 읽고 있습니다.</Text>
            )}
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
